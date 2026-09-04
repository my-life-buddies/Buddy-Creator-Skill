export type Stage = "definition" | "knowledge" | "methods" | "service";
export type Ref = {
  type: "input" | "artifact" | "source";
  id: string;
  hash: string;
  quote?: string;
  locator?: string;
};
export type TargetStatus =
  | "unstarted"
  | "partial"
  | "sufficient"
  | "uncertain"
  | "skipped"
  | "exhausted"
  | "conflict";
export type Target = {
  id: string;
  cycleId: string;
  status: TargetStatus;
  answerInputIds: string[];
  summary: string;
  gaps: string[];
  evidence: Ref[];
};
export type Artifact = {
  id: string;
  stage: Stage;
  kind: "chapter" | "hypothesis" | "scenario" | "blueprint" | "transition";
  title: string;
  markdown: string;
  data?: Record<string, unknown>;
  evidence: Ref[];
  dependencies: Ref[];
  hash: string;
  unresolved: string[];
  revision: string;
};
export type Confirmation = {
  id: string;
  objectId: string;
  hash: string;
  inputId: string;
  deliveryId: string;
  decision: "confirmed" | "accepted" | "rejected";
  evidence: Ref[];
  invalidatedBy?: string;
};
export type ConfirmationTarget = {
  scope: "object" | "booklet";
  stage: Stage;
  objects: { id: string; hash: string }[];
};
export type Delivery = {
  id: string;
  requestId: string;
  revision: string;
  text: string;
  hash: string;
  question?: {
    id: string;
    targetId: string;
    cycleId: string;
    mode: "ordinary" | "example" | "transition";
  };
  confirmationTarget?: ConfirmationTarget;
  kind: "content" | "explanation";
  inputId?: string;
};
export type SourceKind =
  | "file"
  | "webpage"
  | "xiaohongshu" // Legacy archived sources remain readable; new collection is disabled.
  | "history"
  | "mindmap"
  | "skill"
  | "oral"
  | "scan"
  | "audio"
  | "video";
export type SourceManifest = {
  id: string;
  version: string;
  kind: SourceKind;
  title: string;
  uri: string;
  status: "queued" | "running" | "ready" | "failed";
  files: { path: string; hash: string; bytes: number }[];
  chunks: { id: string; text: string; locator: string; hash: string }[];
  error?: string;
  errorDetails?: unknown;
  acquiredAt: string;
  jobId: string;
  attempt: number;
  warnings: string[];
  parser: string;
  extraction?: {
    provider: "host";
    tool: string;
    coverage: "complete" | "partial";
    notes?: string[];
  };
  processing?: {
    acquisition: "queued" | "running" | "complete" | "partial" | "failed";
    parsing: "not_started" | "running" | "complete" | "partial" | "failed";
    semanticReview: "requires_host_calibration";
  };
};
export type ProjectState = {
  schemaVersion: 1;
  rulesVersion: "1.9";
  buddyId: string;
  workspaceId: string;
  revision: string;
  stage: Stage;
  paused: boolean;
  targets: Record<string, Target>;
  cycles: {
    id: string;
    inputId?: string;
    affected: string[];
    previous: Target[];
  }[];
  artifacts: Record<string, Artifact>;
  confirmations: Confirmation[];
  sourcePlan: {
    requiredKinds: SourceKind[];
    sourceIds: string[];
    discoveryClosed: boolean;
  };
  sources: Record<string, { version: string; kind: SourceKind }>;
  serviceMode?: "smart" | "guided";
  serviceModelExplained: boolean;
  currentDeliveryId?: string;
  answeredInputs: string[];
};
export type Input = {
  id: string;
  token: string;
  raw: string;
  hash: string;
  sessionId: string;
  createdAt: string;
  replyToDeliveryId?: string;
  hostMessageId?: string;
  annotation?: {
    objectId: string;
    hash: string;
    text: string;
    draftId?: string;
  };
};
export type Session = {
  id: string;
  host: "codex" | "claude-code" | "workbuddy" | "test";
  epoch: number;
  activeRequestId?: string;
  paused?: boolean;
};
export type Assessment = {
  targetId: string;
  status: TargetStatus;
  summary: string;
  gaps: string[];
  evidence: Ref[];
};
export type ArtifactPatch = Omit<Artifact, "hash" | "revision">;
export type WorkResult = {
  intent:
    | "answer"
    | "supplement"
    | "revise"
    | "confirm"
    | "explain"
    | "pause"
    | "skip"
    | "correct_question"
    | "resume";
  assessments?: Assessment[];
  artifacts?: ArtifactPatch[];
  confirmation?: {
    target: ConfirmationTarget;
    decision: Confirmation["decision"];
    evidence: Ref[];
  };
  majorChange?: {
    affectedTargets: string[];
    evidence: Ref[];
    reason: "positioning" | "audience" | "core_task";
  };
  sourcePlan?: ProjectState["sourcePlan"];
  sourceVersions?: { id: string; version: string }[];
  serviceMode?: "smart" | "guided";
  serviceModelExplained?: boolean;
  delivery: {
    text: string;
    mode?: "ordinary" | "example" | "transition" | "explanation" | "booklet";
    questionTargetId?: string;
    confirmationObjectIds?: string[];
    confirmationScope?: "object" | "booklet";
  };
};
export type WorkKind =
  | "interview_turn"
  | "source_process"
  | "knowledge_synthesis"
  | "artifact_draft"
  | "artifact_revision"
  | "conflict_review"
  | "delivery_compose";
export type WorkItem = {
  requestId: string;
  stepId: string;
  kind: WorkKind;
  dependsOn: string[];
  operationEpoch: number;
  baseRevision: string;
  inputIds: string[];
  contextDigest: string;
  contextRef: string;
  objective: string;
  outputSchemaRef: string;
  executor: "host_reasoning";
  allowedArtifactPaths: string[];
  allowedActions: string[];
  requiredEvidenceRefs: string[];
  status: "issued";
};
export type Turn = {
  requestId: string;
  inputId: string;
  baseRevision: string;
  rootContextDigest: string;
  epoch: number;
  sessionId: string;
  workflowVersion: "1";
  workflowRunId: string;
  plan: { kind: WorkKind; objective: string }[];
  createdAt: string;
};
export type WorkEnvelope = {
  stepId: string;
  operationId: string;
  contextDigest: string;
  baseRevision: string;
  operationEpoch: number;
  output: WorkResult;
};
export type Receipt = {
  operationId: string;
  requestId: string;
  bodyHash: string;
  revision: string;
  deliveryId: string;
};
