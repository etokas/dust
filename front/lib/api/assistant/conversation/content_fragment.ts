import type {
  ContentFragmentInputType,
  ConversationType,
  ModelId,
  Result,
  SupportedFileContentType,
} from "@dust-tt/types";
import {
  Err,
  isContentFragmentInputWithContentType,
  isSupportedUploadableContentFragmentType,
  Ok,
} from "@dust-tt/types";

import type { Authenticator } from "@app/lib/auth";
import {
  fileAttachmentLocation,
  storeContentFragmentText,
} from "@app/lib/resources/content_fragment_resource";
import { FileResource } from "@app/lib/resources/file_resource";

interface ContentFragmentBlob {
  contentType: SupportedFileContentType;
  fileModelId: ModelId | null;
  sourceUrl: string | null;
  textBytes: number | null;
  title: string;
}

export async function getContentFragmentBlob(
  auth: Authenticator,
  conversation: ConversationType,
  cf: ContentFragmentInputType,
  messageId: string
): Promise<Result<ContentFragmentBlob, Error>> {
  const { owner } = conversation;
  const { title, url } = cf;

  if (isContentFragmentInputWithContentType(cf)) {
    const { content, contentType } = cf;

    // TODO(2024-07-03): Remove this once all operations are using files.
    const sourceUrl = isSupportedUploadableContentFragmentType(contentType)
      ? fileAttachmentLocation({
          workspaceId: owner.sId,
          conversationId: conversation.sId,
          messageId,
          contentFormat: "raw",
        }).downloadUrl
      : url;

    // Only store the text if it is not a file.
    const textBytes = await storeContentFragmentText({
      workspaceId: owner.sId,
      conversationId: conversation.sId,
      messageId,
      content,
    });

    return new Ok({
      contentType,
      fileModelId: null,
      sourceUrl,
      textBytes,
      title,
    });
  } else {
    const file = await FileResource.fetchById(auth, cf.fileId);
    if (!file) {
      return new Err(new Error("File not found."));
    }

    // Give priority to the URL if it is provided.
    const sourceUrl = url ?? file.getPublicUrl(auth);
    return new Ok({
      contentType: file.contentType,
      fileModelId: file.id,
      sourceUrl,
      textBytes: null,
      title,
    });
  }
}
