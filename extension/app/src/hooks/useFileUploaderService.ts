import type {
  ConversationPublicType,
  LightWorkspaceType,
  Result,
  SupportedFileContentType,
} from "@dust-tt/client";
import {
  Err,
  isSupportedFileContentType,
  isSupportedImageContentType,
  Ok,
} from "@dust-tt/client";
import { useSendNotification } from "@dust-tt/sparkle";
import { getIncludeCurrentTab } from "@extension/lib/conversation";
import { useDustAPI } from "@extension/lib/dust_api";
import { useState } from "react";

interface FileBlob {
  contentType: SupportedFileContentType;
  file: File;
  filename: string;
  id: string;
  fileId: string | null;
  isUploading: boolean;
  preview?: string;
  size: number;
  publicUrl?: string;
}

type FileBlobUploadErrorCode =
  | "failed_to_upload_file"
  | "file_type_not_supported";

class FileBlobUploadError extends Error {
  constructor(
    readonly code: FileBlobUploadErrorCode,
    readonly file: File,
    msg?: string
  ) {
    super(msg);
  }
}

export const MAX_FILE_SIZES: Record<"plainText" | "image", number> = {
  plainText: 30 * 1024 * 1024, // 30MB.
  image: 5 * 1024 * 1024, // 5 MB
};

const COMBINED_MAX_TEXT_FILES_SIZE = MAX_FILE_SIZES["plainText"] * 2;
const COMBINED_MAX_IMAGE_FILES_SIZE = MAX_FILE_SIZES["image"] * 5;

export function useFileUploaderService({
  owner,
}: {
  owner: LightWorkspaceType;
}) {
  const [fileBlobs, setFileBlobs] = useState<FileBlob[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const sendNotification = useSendNotification();
  const dustAPI = useDustAPI();

  const handleFilesUpload = async (files: File[], updateBlobs?: boolean) => {
    setIsProcessingFiles(true);

    const { totalTextualSize, totalImageSize } = [
      ...fileBlobs,
      ...files,
    ].reduce(
      (acc, content) => {
        const { size } = content;
        if (
          isSupportedImageContentType(
            content instanceof File ? content.type : content.contentType
          )
        ) {
          acc.totalImageSize += size;
        } else {
          acc.totalTextualSize += size;
        }
        return acc;
      },
      { totalTextualSize: 0, totalImageSize: 0 }
    );

    if (
      totalTextualSize > COMBINED_MAX_TEXT_FILES_SIZE ||
      totalImageSize > COMBINED_MAX_IMAGE_FILES_SIZE
    ) {
      sendNotification({
        type: "error",
        title: "Files too large.",
        description:
          "Combined file sizes exceed the limits. Please upload smaller files.",
      });
      return;
    }

    const previewResults = processSelectedFiles(files);
    const newFileBlobs = processResults(previewResults, updateBlobs);

    const uploadResults = await uploadFiles(newFileBlobs);
    const finalFileBlobs = processResults(uploadResults, updateBlobs);

    setIsProcessingFiles(false);

    return finalFileBlobs;
  };

  const handleFileChange = async (e: React.ChangeEvent) => {
    const selectedFiles = Array.from(
      (e?.target as HTMLInputElement).files ?? []
    );

    return handleFilesUpload(selectedFiles);
  };

  const processSelectedFiles = (
    selectedFiles: File[]
  ): Result<FileBlob, FileBlobUploadError>[] => {
    return selectedFiles.reduce(
      (acc, file) => {
        if (fileBlobs.some((f) => f.id === file.name)) {
          sendNotification({
            type: "error",
            title: "File already exists.",
            description: `File "${file.name}" is already uploaded.`,
          });

          return acc; // Ignore if file already exists.
        }

        const contentType = file.type;
        if (!isSupportedFileContentType(contentType)) {
          acc.push(
            new Err(
              new FileBlobUploadError(
                "file_type_not_supported",
                file,
                `File "${file.name}" is not supported.`
              )
            )
          );
          return acc;
        }

        acc.push(new Ok(createFileBlob(file, contentType)));
        return acc;
      },
      [] as (Ok<FileBlob> | Err<FileBlobUploadError>)[]
    );
  };

  const uploadFiles = async (
    newFileBlobs: FileBlob[]
  ): Promise<Result<FileBlob, FileBlobUploadError>[]> => {
    const uploadPromises = newFileBlobs.map(async (fileBlob) => {
      // Get upload URL from server.
      const fileRes = await dustAPI.uploadFile({
        contentType: fileBlob.contentType,
        fileName: fileBlob.filename,
        fileSize: fileBlob.size,
        useCase: "conversation",
        fileObject: fileBlob.file,
      });
      if (fileRes.isErr()) {
        console.error("Error uploading files:", fileRes.error);

        return new Err(
          new FileBlobUploadError(
            "failed_to_upload_file",
            fileBlob.file,
            fileRes.error.message
          )
        );
      }
      const fileUploaded = fileRes.value;

      return new Ok({
        ...fileBlob,
        fileId: fileUploaded.id,
        isUploading: false,
        preview: isSupportedImageContentType(fileBlob.contentType)
          ? `${fileUploaded.downloadUrl}?action=view`
          : undefined,
        publicUrl: fileUploaded.publicUrl,
      });
    });

    return Promise.all(uploadPromises); // Run all uploads in parallel.
  };

  const processResults = (
    results: Result<FileBlob, FileBlobUploadError>[],
    updateBlobs: boolean = true
  ) => {
    const successfulBlobs: FileBlob[] = [];
    const erroredBlobs: FileBlobUploadError[] = [];

    results.forEach((result) => {
      if (result.isErr()) {
        erroredBlobs.push(result.error);
        sendNotification({
          type: "error",
          title: "Failed to upload file.",
          description: result.error.message,
        });
      } else {
        successfulBlobs.push(result.value);
      }
    });

    if (updateBlobs) {
      if (erroredBlobs.length > 0) {
        setFileBlobs((prevFiles) =>
          prevFiles.filter(
            (f) => !erroredBlobs.some((e) => e.file.name === f.id)
          )
        );
      }

      if (successfulBlobs.length > 0) {
        setFileBlobs((prevFiles) => {
          const fileBlobMap = new Map(prevFiles.map((blob) => [blob.id, blob]));
          successfulBlobs.forEach((blob) => {
            fileBlobMap.set(blob.id, blob);
          });
          return Array.from(fileBlobMap.values());
        });
      }
    }

    return successfulBlobs;
  };

  const removeFile = (fileId: string) => {
    const fileBlob = fileBlobs.find((f) => f.id === fileId);

    if (fileBlob) {
      setFileBlobs((prevFiles) =>
        prevFiles.filter((f) => f.fileId !== fileBlob?.fileId)
      );

      // Intentionally not awaiting the fetch call to allow it to run asynchronously.
      void fetch(`/api/w/${owner.sId}/files/${fileBlob.fileId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const allFilesReady = fileBlobs.every((f) => f.isUploading === false);
      if (allFilesReady && isProcessingFiles) {
        setIsProcessingFiles(false);
      }
    }
  };

  const resetUpload = () => {
    setFileBlobs([]);
  };

  const uploadContentTab = async (
    conversation?: ConversationPublicType,
    updateBlobs?: boolean
  ) => {
    const tabContentRes = await getIncludeCurrentTab();

    if (tabContentRes && tabContentRes.isErr()) {
      sendNotification({
        title: "Cannot get tab content",
        description: tabContentRes.error.message,
        type: "error",
      });
      return;
    }

    const tabContent =
      tabContentRes && tabContentRes.isOk() ? tabContentRes.value : null;

    if (!tabContent?.content) {
      sendNotification({
        title: "Cannot get tab content",
        description: "No content found.",
        type: "error",
      });
      return;
    }

    const title = `${tabContent.title}.txt`;
    // Check if the content is already uploaded - compare the title and the size of the content.
    const alreadyUploaded = conversation?.content
      .map((m) => m[m.length - 1])
      .some(
        (m) =>
          m.type === "content_fragment" &&
          m.title === title &&
          m.textBytes === new Blob([tabContent.content ?? ""]).size
      );

    if (tabContent && tabContent.content && !alreadyUploaded) {
      const file = new File([tabContent.content], title, {
        type: "text/plain",
      });

      return await handleFilesUpload([file], updateBlobs);
    }
  };

  const uploadContentTabAsScreenshot = async () => {
    const tabContentRes = await getIncludeCurrentTab(false, true);

    if (tabContentRes && tabContentRes.isErr()) {
      sendNotification({
        title: "Cannot get tab content",
        description: tabContentRes.error.message,
        type: "error",
      });
    }

    const tabContent =
      tabContentRes && tabContentRes.isOk() ? tabContentRes.value : null;

    if (tabContent && tabContent.screenshot) {
      const response = await fetch(tabContent.screenshot);
      const blob = await response.blob();
      const file = new File([blob], `${tabContent.title}.jpg`, {
        type: blob.type,
      });

      return await handleFilesUpload([file]);
    }
  };

  type FileBlobWithFileId = FileBlob & { fileId: string };
  function fileBlobHasFileId(
    fileBlob: FileBlob
  ): fileBlob is FileBlobWithFileId {
    return fileBlob.fileId !== null;
  }

  const getFileBlobs: () => FileBlobWithFileId[] = () => {
    return fileBlobs.filter(fileBlobHasFileId);
  };

  return {
    fileBlobs,
    getFileBlobs,
    handleFileChange,
    handleFilesUpload,
    isProcessingFiles,
    uploadContentTab,
    uploadContentTabAsScreenshot,
    removeFile,
    resetUpload,
  };
}

export type FileUploaderService = ReturnType<typeof useFileUploaderService>;

const createFileBlob = (
  file: File,
  contentType: SupportedFileContentType,
  preview?: string
): FileBlob => ({
  contentType,
  file,
  filename: file.name,
  id: file.name,
  // Will be set once the file has been uploaded.
  fileId: null,
  isUploading: true,
  preview,
  size: file.size,
});