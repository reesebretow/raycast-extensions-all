import {
  Detail,
  ActionPanel,
  Action,
  Icon,
  getPreferenceValues,
  environment,
  showToast,
  Toast,
  Clipboard,
  closeMainWindow,
  LaunchProps,
  BrowserExtension,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { Arguments, Metadata, Preferences } from "./types";
import { fetchJinaMarkdown } from "./services/jina-service";
import { processMarkdownContent } from "./utils/markdown-utils";
import { MetadataSection } from "./components/MetadataSection";
import { addFrontMatter } from "./utils/get-prefs";

// URL utility functions
/**
 * Check if the provided string is a valid URL.
 * @param {string} url - The URL to validate
 * @returns {boolean} - Whether the URL is valid
 */
function isValidURL(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    return false;
  }
}

/**
 * Extracts a URL from the provided text.
 * @param {string} text - The text to extract from
 * @returns {string | null} - The extracted URL or null if none found
 */
function extractURLFromText(text: string): string | null {
  // Match URLs that start with http:// or https://
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex);

  if (matches && matches.length > 0) {
    // Get the first URL and clean it up if needed
    const url = matches[0].trim();

    // Remove any trailing punctuation or parentheses that might be part of the text
    const cleanUrl = url.replace(/[.,;:!?)]+$/, "");

    if (isValidURL(cleanUrl)) {
      return cleanUrl;
    }
  }

  return null;
}

// Extended preferences for the browser tab to markdown command
interface BrowserTabPreferences extends Preferences {
  useClipboardFallback: boolean;
  autoCopyToClipboard: boolean;
  silentMode: boolean;
  includeLinksSummary: boolean;
  prependFrontMatter: boolean;
  includeMetadata: boolean;
}

export default function Command(props: LaunchProps) {
  const [markdown, setMarkdown] = useState<string>("");
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [metadata, setMetadata] = useState<Metadata>({});
  const [extensionAccessible, setExtensionAccessible] = useState<boolean>(false);
  const preferences = getPreferenceValues<BrowserTabPreferences>();
  const isBackground = props.launchType === "background";

  // Extract all preference values needed in the component
  const {
    useClipboardFallback,
    autoCopyToClipboard,
    silentMode,
    includeLinksSummary,
    prependFrontMatter,
    includeMetadata,
  } = preferences;

  // Close window immediately if in silent mode
  useEffect(() => {
    if (silentMode) {
      showToast({
        style: Toast.Style.Animated,
        title: "Browser Tab to Markdown",
        message: "Looking for active browser tab...",
      });
      closeMainWindow();
    }
  }, [silentMode]);

  useEffect(() => {
    // Create a flag to prevent race conditions with multiple API calls
    let isMounted = true;

    async function getUrlFromBrowserTab() {
      try {
        // Directly try to use the Browser Extension API
        // This will prompt the user to install the extension if they don't have it
        const tabs = await BrowserExtension.getTabs();
        const activeTab = tabs.find((tab) => tab.active);

        if (activeTab && activeTab.url) {
          setExtensionAccessible(true);
          return activeTab.url;
        }

        // No active tab found with a URL
        setExtensionAccessible(true);
        throw new Error("No active browser tab found");
      } catch (error) {
        console.log("Error with browser extension:", error);
        setExtensionAccessible(false);

        // Extension not available or user declined installation
        // Check clipboard if enabled
        if (useClipboardFallback) {
          try {
            const clipboardText = await Clipboard.readText();
            if (clipboardText) {
              const extractedUrl = extractURLFromText(clipboardText);
              if (extractedUrl) {
                return extractedUrl;
              }
            }
          } catch (clipboardError) {
            console.log("Error reading from clipboard:", clipboardError);
          }
        }

        // No URL found from any source
        if (error instanceof Error) {
          throw error; // Rethrow the original error
        } else {
          throw new Error(
            "Browser extension not accessible" + (useClipboardFallback ? " and no valid URL found in clipboard" : ""),
          );
        }
      }
    }

    async function fetchMarkdown() {
      try {
        if (!isMounted) return;
        setMarkdown("# Getting URL from browser tab...");

        // Get URL from browser tab or clipboard
        const detectedUrl = await getUrlFromBrowserTab();
        if (!isMounted) return;
        setUrl(detectedUrl);

        setMarkdown("# Converting webpage to Markdown...\n\n> Loading content from: " + detectedUrl);

        // Show toast in silent mode
        if (silentMode) {
          // Extract domain for a cleaner message
          let domain = "";
          try {
            domain = new URL(detectedUrl).hostname.replace("www.", "");
          } catch (e) {
            domain = detectedUrl;
          }

          await showToast({
            style: Toast.Style.Animated,
            title: "Converting Webpage",
            message: `Converting ${domain} to markdown...`,
          });
        }

        // Fetch and process the markdown content
        const response = await fetchJinaMarkdown(detectedUrl, preferences);
        if (!isMounted) return;

        const { markdown: processedMarkdown, metadata: newMetadata } = processMarkdownContent(
          response.data.content,
          response.data.title,
          response.data.links,
          includeLinksSummary,
        );

        setMetadata(newMetadata);

        let finalMarkdown = processedMarkdown;
        if (prependFrontMatter) {
          finalMarkdown = addFrontMatter(processedMarkdown, {
            title: response.data.title,
            sourceUrl: detectedUrl,
            wordCount: newMetadata.wordCount || 0,
            readingTime: newMetadata.readingTime || "",
          });
        }

        setMarkdown(finalMarkdown);

        // Log for debugging
        console.log(`Auto-copy enabled: ${autoCopyToClipboard}, Silent mode: ${silentMode}`);

        // Auto-copy to clipboard if enabled
        if (autoCopyToClipboard) {
          try {
            await Clipboard.copy(finalMarkdown);
            console.log("Content copied to clipboard");

            // Always show a toast when auto-copying in silent mode
            if (silentMode) {
              // Calculate size - handle small files better
              const sizeKB = finalMarkdown.length / 1024;
              const sizeText = sizeKB < 1 ? `${Math.round(finalMarkdown.length)} bytes` : `${sizeKB.toFixed(1)}KB`;

              await showToast({
                style: Toast.Style.Success,
                title: "Copied to Clipboard",
                message: `${sizeText} copied - conversion complete`,
              });
            }
          } catch (clipError) {
            console.error("Error copying to clipboard:", clipError);
            if (silentMode) {
              await showToast({
                style: Toast.Style.Failure,
                title: "Auto-copy failed",
                message: "Could not copy to clipboard",
              });
            }
          }
        } else if (silentMode) {
          // Calculate size - handle small files better
          const sizeKB = finalMarkdown.length / 1024;
          const sizeText = sizeKB < 1 ? `${Math.round(finalMarkdown.length)} bytes` : `${sizeKB.toFixed(1)}KB`;

          // Show completion toast in silent mode when not auto-copying
          await showToast({
            style: Toast.Style.Success,
            title: "Conversion Successful",
            message: `Ready: ${sizeText} (open command to copy)`,
          });
        }
      } catch (error) {
        console.error("Error converting URL:", error);
        if (!isMounted) return;

        setError(error instanceof Error ? error : new Error("An unknown error occurred"));
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";

        setMarkdown(
          [
            "# Unable to Convert Webpage",
            "",
            errorMessage,
            "",
            "Please make sure:",
            extensionAccessible
              ? "- A browser tab is active and accessible"
              : "- You have the Raycast Browser Extension installed",
            "- The webpage is publicly accessible",
            "- The URL points to a valid webpage",
            useClipboardFallback
              ? "- You have a valid URL in your clipboard as a fallback"
              : "- Consider enabling clipboard fallback in preferences",
          ].join("\n"),
        );

        if (silentMode) {
          // Create a more specific error message based on the error type
          let errorTitle = "Conversion Failed";
          let errorMsg = errorMessage;

          if (errorMessage.includes("Browser extension")) {
            errorTitle = "Browser Extension Error";
            errorMsg = "Could not access browser tabs";
          } else if (errorMessage.includes("no valid URL")) {
            errorTitle = "No URL Found";
            errorMsg = "No URL in browser tab or clipboard";
          } else if (errorMessage.includes("rate limit")) {
            errorTitle = "API Rate Limit";
            errorMsg = "Jina.ai API rate limited - try adding API key in preferences";
          } else if (errorMessage.includes("active browser tab")) {
            errorTitle = "No Active Tab";
            errorMsg = "No active browser tab found with URL";
          }

          await showToast({
            style: Toast.Style.Failure,
            title: errorTitle,
            message: errorMsg,
          });
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchMarkdown();

    // Cleanup function to prevent state updates after unmounting
    return () => {
      isMounted = false;
    };
  }, [useClipboardFallback, autoCopyToClipboard, silentMode, isBackground]);

  // Handle errors with toast
  useEffect(() => {
    if (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Something went wrong",
        message: error.message,
      });
    }
  }, [error]);

  return (
    <Detail
      markdown={markdown}
      isLoading={isLoading}
      navigationTitle={metadata.title || (url ? "Converting..." : "No URL found")}
      metadata={includeMetadata && url ? <MetadataSection url={url} metadata={metadata} /> : undefined}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy Markdown" content={markdown} icon={Icon.Clipboard} />
            {url && <Action.OpenInBrowser title="Open Original URL" url={url} icon={Icon.Globe} />}
            <Action title="Close Window" onAction={() => closeMainWindow()} icon={Icon.XmarkCircle} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
