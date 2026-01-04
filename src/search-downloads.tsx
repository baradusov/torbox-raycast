import { ActionPanel, Action, List, getPreferenceValues, showToast, Toast, Clipboard, Color } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useState, useMemo } from "react";
import { fetchDownloads, getDownloadLink, deleteDownload, DownloadType } from "./api";

interface Preferences {
  apiKey: string;
}

interface BaseDownload {
  id: number;
  name: string;
  size: number;
  progress: number;
  download_state: string;
  download_present: boolean;
  download_finished: boolean;
  created_at: string;
  updated_at: string;
}

interface Torrent extends BaseDownload {
  hash: string;
  download_speed: number;
}

type WebDownload = BaseDownload;

type UsenetDownload = BaseDownload;

interface Download extends BaseDownload {
  type: DownloadType;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getTypeLabel(type: DownloadType): string {
  switch (type) {
    case "torrent":
      return "Torrent";
    case "webdl":
      return "Web";
    case "usenet":
      return "Usenet";
  }
}

function addType<T extends BaseDownload>(downloads: T[], type: DownloadType): Download[] {
  return downloads.map((d) => ({ ...d, type }));
}

async function fetchAllDownloads(apiKey: string): Promise<Download[]> {
  const [torrents, webDownloads, usenetDownloads] = await Promise.all([
    fetchDownloads<Torrent>(apiKey, "torrents"),
    fetchDownloads<WebDownload>(apiKey, "webdl"),
    fetchDownloads<UsenetDownload>(apiKey, "usenet"),
  ]);

  const allDownloads: Download[] = [
    ...addType(torrents, "torrent"),
    ...addType(webDownloads, "webdl"),
    ...addType(usenetDownloads, "usenet"),
  ];

  allDownloads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return allDownloads;
}

function getStatusTag(download: Download): { value: string; color: Color } {
  if (download.download_finished || download.progress >= 1) {
    return { value: "Ready", color: Color.Green };
  }
  return { value: `${Math.round(download.progress * 100)}%`, color: Color.Orange };
}

function DownloadListItem({
  download,
  apiKey,
  onRefresh,
}: {
  download: Download;
  apiKey: string;
  onRefresh: () => void;
}) {
  const statusTag = getStatusTag(download);
  const isReady = download.download_finished || download.progress >= 1;

  return (
    <List.Item
      title={download.name}
      subtitle={`${formatBytes(download.size)} · ${getTypeLabel(download.type)}`}
      accessories={[{ tag: { value: statusTag.value, color: statusTag.color } }]}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {isReady && (
              <Action
                title="Copy Download Link"
                onAction={async () => {
                  try {
                    await showToast({ style: Toast.Style.Animated, title: "Getting download link..." });
                    const link = await getDownloadLink(apiKey, download.type, download.id);
                    await Clipboard.copy(link);
                    await showToast({ style: Toast.Style.Success, title: "Download link copied!" });
                  } catch (error) {
                    await showToast({
                      style: Toast.Style.Failure,
                      title: "Failed to get download link",
                      message: error instanceof Error ? error.message : "Unknown error",
                    });
                  }
                }}
              />
            )}
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action title="Refresh All Downloads" shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={onRefresh} />
            <Action
              title="Delete Download"
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["ctrl"], key: "x" }}
              onAction={async () => {
                try {
                  await showToast({ style: Toast.Style.Animated, title: "Deleting download..." });
                  await deleteDownload(apiKey, download.type, download.id);
                  await showToast({ style: Toast.Style.Success, title: "Download deleted" });
                  onRefresh();
                } catch (error) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: "Failed to delete download",
                    message: error instanceof Error ? error.message : "Unknown error",
                  });
                }
              }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [searchText, setSearchText] = useState("");

  const { data, isLoading, error, revalidate } = useCachedPromise(fetchAllDownloads, [preferences.apiKey], {
    keepPreviousData: true,
  });

  const filteredDownloads = useMemo(() => {
    if (!data) return [];

    if (searchText.length === 0) {
      return data;
    }

    const searchLower = searchText.toLowerCase();
    return data.filter((download) => download.name.toLowerCase().includes(searchLower));
  }, [data, searchText]);

  if (error) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to fetch downloads",
      message: error.message,
    });
  }

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search your TorBox downloads..."
      throttle
    >
      <List.Section title={searchText ? "Search Results" : "All Downloads"} subtitle={`${filteredDownloads.length}`}>
        {filteredDownloads.map((download) => (
          <DownloadListItem
            key={`${download.type}-${download.id}`}
            download={download}
            apiKey={preferences.apiKey}
            onRefresh={revalidate}
          />
        ))}
      </List.Section>
    </List>
  );
}
