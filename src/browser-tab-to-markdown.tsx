import {
  Detail,
  ActionPanel,
  Action,
  Icon,
  getPreferenceValues,
  environment,
  BrowserExtension,
  Toast,
  showToast,
  Clipboard,
  closeMainWindow,
  LaunchType,
  LaunchProps,
} from "@raycast/api";
import { useState, useEffect } from "react";
import { Metadata, Preferences } from "./types";
import { fetchJinaMarkdown } from "./services/jina-service";
import { processMarkdownContent } from "./utils/markdown-utils";
import { MetadataSection } from "./components/MetadataSection";
import { addFrontMatter } from "./utils/get-prefs";

/**
 * Checks if a string is a valid URL
 * @param {string} string - The string to check
 * @returns {boolean} - Whether the string is a valid URL
 */
function isValidURL(string: string): boolean {
  if (!string) return false;

  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

/**
 * Extracts a URL from text if present
 * @param {string} text - The text to extract a URL from
 * @returns {string|null} - The extracted URL or null if none found
 */
function extractURL(text: string): string | null {
  if (!text) return null;

  // First check if the entire text is a URL
  if (isValidURL(text)) {
    return text;
  }

  // Try to find URLs in text using regex
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);

  if (matches && matches.length > 0) {
    // Return the first URL found
    return matches[0];
  }

  return null;
}

export default function Command(props: LaunchProps) {
  const [markdown, setMarkdown] = useState<string>("Processing...");
  const [isLoading, setIsLoading] = useState(true);
  const [metadata, setMetadata] = useState<Metadata>({});
  const [url, setUrl] = useState<string>("");
  const preferences = getPreferenceValues<Preferences>();

  // Extract the command-specific preferences
  const useClipboardFallback = preferences.useClipboardFallback !== undefined ? preferences.useClipboardFallback : true;
  const autoCopyToClipboard = preferences.autoCopyToClipboard || false;
  const silentMode = preferences.silentMode || false;

  // Check if silent mode is enabled and auto-copy is enabled
  const shouldRunSilently = silentMode && autoCopyToClipboard;

  // Check if this is a background launch (Raycast loses focus)
  const isBackgroundLaunch = props.launchType === LaunchType.Background;

  // Combined flag for fully silent operation
  const isFullySilent = shouldRunSilently || isBackgroundLaunch;

  useEffect(() => {
    async function fetchBrowserTabAndConvert() {
      try {
        console.log("------- URL DETECTION FLOW START -------");
        let activeUrl = "";
        let sourceType = "";
        let browserName = "";

        // Check if Browser Extension is accessible
        if (environment.canAccess(BrowserExtension)) {
          console.log("Browser Extension accessible: Yes");

          try {
            console.log("Retrieving active browser tab...");
            const tabs = await BrowserExtension.getTabs();
            console.log(`Found ${tabs.length} tabs from Browser Extension`);

            // Find the active tab
            const activeTab = tabs.find((tab) => tab.active === true);

            if (activeTab && activeTab.url && isValidURL(activeTab.url)) {
              activeUrl = activeTab.url;
              sourceType = "browser extension";

              // Determine browser name from URL or use a generic name
              browserName = "Browser"; // Default

              // Try to detect the browser from the URL or browser details
              if (activeTab.url) {
                if (activeTab.url.includes("arc.net") || activeTab.url.includes("arc.browser")) {
                  browserName = "Arc";
                } else if (activeTab.url.includes("chrome-extension://")) {
                  browserName = "Chrome";
                } else if (activeTab.url.includes("safari-extension://")) {
                  browserName = "Safari";
                } else if (activeTab.url.includes("firefox-extension://")) {
                  browserName = "Firefox";
                } else if (activeTab.url.includes("edge-extension://")) {
                  browserName = "Edge";
                }
              }

              console.log("✅ Got URL from Browser Extension:", activeUrl);
              console.log("Browser:", browserName);

              // Show success toast if not in silent mode
              if (!isFullySilent) {
                await showToast({
                  style: Toast.Style.Success,
                  title: `Using ${browserName} URL`,
                  message: "URL detected from active browser tab",
                });
              }
            } else {
              console.log("❌ No active tab found with valid URL");
              // No active tab found, we'll fall back to clipboard if enabled
            }
          } catch (error) {
            console.error("Error accessing browser tabs:", error);
          }
        } else {
          console.log("❌ Browser Extension is not accessible");

          // Show a toast about the missing browser extension if not in silent mode
          if (!isFullySilent) {
            await showToast({
              style: Toast.Style.Failure,
              title: "Browser Extension Required",
              message: "Please install the Raycast Browser Extension",
            });
          }
        }

        // If no URL from browser extension and clipboard fallback is enabled
        if (!activeUrl && useClipboardFallback) {
          try {
            console.log("Trying clipboard fallback...");
            const clipboardText = await Clipboard.readText();
            console.log("Clipboard contains text:", clipboardText ? "Yes" : "No");

            if (clipboardText) {
              // Try to extract a URL from clipboard text
              const extractedUrl = extractURL(clipboardText);
              if (extractedUrl) {
                activeUrl = extractedUrl;
                sourceType = "clipboard";
                console.log("📋 Using URL from clipboard:", activeUrl);

                // Show notification if not in silent mode
                if (!isFullySilent) {
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Using Clipboard URL",
                    message: "No active browser tab found",
                  });
                }
              } else {
                console.log("❌ No valid URL found in clipboard content");
              }
            } else {
              console.log("❌ Clipboard is empty");
            }
          } catch (error) {
            console.error("Error reading clipboard:", error);
          }
        }

        console.log("------- URL DETECTION SUMMARY -------");
        console.log(`URL found: ${activeUrl ? "YES" : "NO"}`);
        console.log(`Source: ${sourceType || "None"}`);
        console.log(`Browser: ${browserName || "Unknown"}`);
        console.log("------- URL DETECTION FLOW END -------");

        // If no valid URL found
        if (!activeUrl) {
          const errorMessage =
            "No valid URL found in active browser tab" + (useClipboardFallback ? " or clipboard" : "");

          // Always show error toast
          await showToast({
            style: Toast.Style.Failure,
            title: "No Valid URL Found",
            message: errorMessage,
          });

          if (!isFullySilent) {
            setMarkdown(
              [
                "# No Valid URL Found",
                "",
                errorMessage,
                "",
                "Please make sure:",
                "- You have an active browser tab with a valid URL",
                "- The Raycast Browser Extension is installed and has necessary permissions",
                useClipboardFallback ? "- Or you have copied a valid URL to your clipboard" : "",
              ]
                .filter(Boolean)
                .join("\n"),
            );
          }

          // Close window in silent mode even on errors
          if (isFullySilent) {
            await closeMainWindow({ clearRootSearch: true });
          }

          setIsLoading(false);
          return;
        }

        // We have a valid URL
        setUrl(activeUrl);

        if (!isFullySilent) {
          setMarkdown(
            "# Converting webpage to Markdown...\n\n> Loading content from: " +
              activeUrl +
              (sourceType === "clipboard" ? " (from clipboard)" : ` (from ${browserName || "browser"})`),
          );
        } else {
          // For silent mode, show a "working on it" toast
          await showToast({
            style: Toast.Style.Animated,
            title: "Converting to Markdown",
            message: `Processing ${sourceType === "clipboard" ? "clipboard URL" : "browser tab"}...`,
          });
        }

        // Fetch and process the markdown
        const response = await fetchJinaMarkdown(activeUrl, preferences);
        const { markdown: processedMarkdown, metadata: newMetadata } = processMarkdownContent(
          response.data.content,
          response.data.title,
          response.data.links,
          preferences.includeLinksSummary,
        );

        setMetadata(newMetadata);

        let finalMarkdown = processedMarkdown;
        if (preferences.prependFrontMatter) {
          finalMarkdown = addFrontMatter(processedMarkdown, {
            title: response.data.title,
            sourceUrl: activeUrl,
            wordCount: newMetadata.wordCount || 0,
            readingTime: newMetadata.readingTime || "",
          });
        }

        // Set the markdown state
        setMarkdown(finalMarkdown);

        // If auto-copy is enabled, copy to clipboard
        if (autoCopyToClipboard) {
          await Clipboard.copy(finalMarkdown);

          // Show success notification
          await showToast({
            style: Toast.Style.Success,
            title: "Copied to Clipboard",
            message: `${Math.ceil(finalMarkdown.length / 1000)}K characters | ${newMetadata.wordCount || 0} words`,
          });

          // If silent mode is enabled, close the window
          if (silentMode === true && isFullySilent === true) {
            console.log("Closing window because silent mode is enabled");
            await closeMainWindow({ clearRootSearch: true });
          }
        }
      } catch (error) {
        console.error("Error converting URL:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";

        // Always show error toasts
        await showToast({
          style: Toast.Style.Failure,
          title: "Conversion Failed",
          message: errorMessage.substring(0, 50) + (errorMessage.length > 50 ? "..." : ""),
        });

        if (!isFullySilent) {
          setMarkdown(
            [
              "# Unable to Convert Webpage",
              "",
              errorMessage,
              "",
              "Please make sure:",
              "- You have an active browser tab open",
              "- The webpage is publicly accessible",
              "- The URL points to a valid webpage",
            ].join("\n"),
          );
        } else {
          // Close window in silent mode even on errors
          if (silentMode === true) {
            await closeMainWindow({ clearRootSearch: true });
          }
        }
      } finally {
        setIsLoading(false);
      }
    }

    // Start processing immediately
    fetchBrowserTabAndConvert();

    // If in silent mode, try to close window as soon as possible
    if (silentMode === true && isFullySilent === true) {
      console.log("Initial window close attempt because silent mode is enabled");
      // Use a short timeout to give Raycast time to register the command
      // but still minimize UI flash
      setTimeout(() => {
        closeMainWindow({ clearRootSearch: true }).catch(() => {
          // Ignore errors from early close attempt
        });
      }, 100);
    }
  }, [
    preferences.prependFrontMatter,
    preferences.includeLinksSummary,
    useClipboardFallback,
    autoCopyToClipboard,
    silentMode,
    shouldRunSilently,
    isBackgroundLaunch,
    isFullySilent,
  ]);

  // In fully silent mode, return a completely empty UI
  if (silentMode === true && isFullySilent === true) {
    return (
      <Detail
        markdown=""
        isLoading={false}
        navigationTitle=""
        actions={
          <ActionPanel>
            <ActionPanel.Section></ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  }

  // Regular UI
  return (
    <Detail
      markdown={markdown}
      isLoading={isLoading}
      navigationTitle={metadata.title || "Converting..."}
      metadata={preferences.includeMetadata ? <MetadataSection url={url} metadata={metadata} /> : undefined}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy Markdown" content={markdown} icon={Icon.Clipboard} />
            {url && <Action.OpenInBrowser title="Open Original URL" url={url} icon={Icon.Globe} />}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
