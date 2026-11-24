import type { ClientMessage, ServerMessage } from "@road-crew/contracts";

type AnyMessage = ClientMessage | ServerMessage;

export function highestServerSeq(messages: AnyMessage[]): number;

export function unreadCount(messages: AnyMessage[], readSeq: number): number;
