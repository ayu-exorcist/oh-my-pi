import { isRecord } from "@ayulab/runtime-core";

export interface TreeEntryRecord {
  readonly id: string;
  readonly parentId?: string | null;
  readonly type?: string;
  readonly message?: unknown;
  readonly customType?: string;
}

export interface UserMessageEntryRecord extends TreeEntryRecord {
  readonly type: "message";
  readonly message: { readonly role: "user" };
}

export interface TreeEventRecord {
  readonly oldLeafId: string | undefined;
  readonly targetId: string | undefined;
  readonly newLeafId: string | undefined;
  readonly userWantsSummary: boolean | undefined;
  readonly preparation:
    | { readonly targetId: string; readonly userWantsSummary: boolean | undefined }
    | undefined;
}

export function isEntryWithId(value: unknown): value is TreeEntryRecord {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  return (
    value.parentId === undefined || value.parentId === null || typeof value.parentId === "string"
  );
}

export function isUserMessageEntry(value: unknown): value is UserMessageEntryRecord {
  if (!isEntryWithId(value) || value.type !== "message" || !isRecord(value.message)) {
    return false;
  }
  return value.message.role === "user";
}

export function isCheckpointCustomEntry(value: unknown): boolean {
  return isEntryWithId(value) && value.type === "custom" && value.customType === "pi-checkpoint";
}

export function getTreeEventRecord(value: unknown): TreeEventRecord | undefined {
  if (!isRecord(value)) return undefined;

  const preparation = value.preparation;
  const treePreparation = isRecord(preparation) ? preparation : undefined;
  const targetId =
    typeof value.targetId === "string"
      ? value.targetId
      : typeof treePreparation?.targetId === "string"
        ? treePreparation.targetId
        : undefined;

  return {
    oldLeafId:
      typeof value.oldLeafId === "string"
        ? value.oldLeafId
        : typeof treePreparation?.oldLeafId === "string"
          ? treePreparation.oldLeafId
          : undefined,
    targetId,
    newLeafId: typeof value.newLeafId === "string" ? value.newLeafId : undefined,
    userWantsSummary:
      typeof treePreparation?.userWantsSummary === "boolean"
        ? treePreparation.userWantsSummary
        : undefined,
    preparation:
      treePreparation && typeof treePreparation.targetId === "string"
        ? {
            targetId: treePreparation.targetId,
            userWantsSummary:
              typeof treePreparation.userWantsSummary === "boolean"
                ? treePreparation.userWantsSummary
                : undefined,
          }
        : undefined,
  };
}

export function toTreeEntryRecords(entries: readonly unknown[]): readonly TreeEntryRecord[] {
  return entries.filter(isEntryWithId);
}
