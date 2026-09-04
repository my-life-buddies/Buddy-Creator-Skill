import type { Delivery, Input, ProjectState, Receipt, Session, SourceManifest } from "./types.js";
type Revision = {
    parent?: string;
    state: ProjectState;
    receipt?: Receipt;
    delivery?: Delivery;
};
type Dialogue = {
    latestInputId?: string;
    activeDeliveryId?: string;
    questionDeliveryId?: string;
};
type Ticket = {
    token: string;
    sessionId: string;
    clientKey: string;
    createdAt: string;
    inputId: string;
    ordinal: number;
    replyToDeliveryId?: string;
};
export declare class Store {
    directory: string;
    constructor(directory: string);
    path(...parts: string[]): string;
    load(): ProjectState;
    revision(revision: string): Revision;
    session(): Session | undefined;
    requireSession(sessionId: string): Session;
    connect(host: Session["host"], sessionId?: string, takeover?: boolean): Session;
    dialogue(): Dialogue;
    reserve(sessionId: string, clientKey: string, replyToDeliveryId?: string): Ticket;
    pendingInputs(sessionId: string): {
        input: Input | undefined;
        token: string;
        sessionId: string;
        clientKey: string;
        createdAt: string;
        inputId: string;
        ordinal: number;
        replyToDeliveryId?: string;
    }[];
    inputHistory(sessionId: string, offset?: number, limit?: number): {
        inputs: {
            input: Input | undefined;
            token: string;
            sessionId: string;
            clientKey: string;
            createdAt: string;
            inputId: string;
            ordinal: number;
            replyToDeliveryId?: string;
        }[];
        nextOffset: number | null;
        total: number;
    };
    record(sessionId: string, token: string, raw: string, annotation?: Input["annotation"]): Input;
    private reconcileInput;
    input(inputId: string): Input;
    source(sourceId: string, version?: string): SourceManifest;
    sourceList(): SourceManifest[];
    delivery(deliveryId: string): Delivery;
    shown(deliveryId: string): boolean;
    presentation(deliveryId: string, method: "host_reported"): {};
    isDeliveryValid(d: Delivery): boolean;
    deliveryDirective(deliveryId?: string): {
        directive: string;
        delivery?: undefined;
        supersededDeliveryId?: undefined;
    } | {
        directive: string;
        delivery: Delivery;
        supersededDeliveryId?: undefined;
    } | {
        directive: string;
        supersededDeliveryId: string;
        delivery?: undefined;
    };
    findReceipt(operationId: string): Receipt | undefined;
    publishCommittedDelivery(d: Delivery): void;
    reconcile(): void;
    commit(baseRevision: string, state: ProjectState, delivery: Delivery, operationId: string, requestId: string, bodyHash: string, afterHead?: () => void): Receipt;
    conversation(delivery: Delivery, operationId: string, bodyHash: string): Receipt;
}
export declare function locateWorkspace(buddyId: string, options?: {
    home?: string;
    root?: string;
    workspace?: string;
}): {
    path: string;
    registry: {
        roots: string[];
        buddies: Record<string, string>;
        preferred?: Record<string, string>;
    };
    directory: string;
    existing: boolean;
};
export declare function openWorkspace(buddyId: string, options?: {
    home?: string;
    root?: string;
    workspace?: string;
}): Promise<Store>;
export {};
