import type { ClientMessage, ServerMessage } from "@road-crew/contracts";

type AnyMessage = ClientMessage | ServerMessage;

export function mergeMessages(
  existing: AnyMessage[],
  incoming: AnyMessage[],
  maxLocalMessages?: number,
): ClientMessage[];

export function highestServerSeq(messages: AnyMessage[]): number;

export function unreadCount(messages: AnyMessage[], readSeq: number): number;
