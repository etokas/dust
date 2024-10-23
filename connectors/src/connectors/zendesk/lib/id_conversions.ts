import type { ModelId } from "@dust-tt/types";

/**
 * Conversion from an id to an internalId.
 */
export function getBrandInternalId(
  connectorId: ModelId,
  brandId: number
): string {
  return `zendesk-brand-${connectorId}-${brandId}`;
}

export function getHelpCenterInternalId(connectorId: ModelId): string {
  return `zendesk-help-center-${connectorId}`;
}

export function getCategoryInternalId(
  connectorId: ModelId,
  categoryId: number
): string {
  return `zendesk-category-${connectorId}-${categoryId}`;
}

export function getArticleInternalId(
  connectorId: ModelId,
  articleId: number
): string {
  return `zendesk-article-${connectorId}-${articleId}`;
}

export function getTicketsInternalId(connectorId: ModelId): string {
  return `zendesk-tickets-${connectorId}`;
}

export function getTicketInternalId(
  connectorId: ModelId,
  teamId: number
): string {
  return `zendesk-ticket-${connectorId}-${teamId}`;
}

export function getConversationInternalId(
  connectorId: ModelId,
  conversationId: number
): string {
  return `zendesk-category-${connectorId}-${conversationId}`;
}

/**
 * Conversion from an internalId to an id.
 */
function _getIdFromInternal(internalId: string, prefix: string): number | null {
  return internalId.startsWith(prefix)
    ? parseInt(internalId.replace(prefix, ""))
    : null;
}

export function getBrandIdFromInternalId(
  connectorId: ModelId,
  internalId: string
): number | null {
  return _getIdFromInternal(internalId, `zendesk-brand-${connectorId}-`);
}

export function isInternalIdOnWholeHelpCenter(
  connectorId: ModelId,
  internalId: string
): boolean {
  return internalId === `zendesk-help-center-${connectorId}`;
}

export function getCategoryIdFromInternalId(
  connectorId: ModelId,
  internalId: string
): number | null {
  return _getIdFromInternal(internalId, `zendesk-category-${connectorId}-`);
}

export function getArticleIdFromInternalId(
  connectorId: ModelId,
  internalId: string
): number | null {
  return _getIdFromInternal(internalId, `zendesk-article-${connectorId}-`);
}

export function isInternalIdOnAllTickets(
  connectorId: ModelId,
  internalId: string
): boolean {
  return internalId === `zendesk-tickets-${connectorId}`;
}

export function getTicketIdFromInternalId(
  connectorId: ModelId,
  internalId: string
): number | null {
  return _getIdFromInternal(internalId, `zendesk-ticket-${connectorId}-`);
}
