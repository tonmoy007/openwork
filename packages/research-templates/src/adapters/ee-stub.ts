/**
 * EE adapter stubs. Identical signatures to the local ports; every call
 * throws typed `EE_NOT_CONFIGURED` until P2 wires the Den marketplace,
 * org roles, and managed inference. MIT core never imports `ee/`.
 */
import { EE_NOT_CONFIGURED, StoreError } from "@openwork/research-templates/ports"
import type {
  AccessControl,
  AuditSink,
  InferenceRunner,
  TemplateStore,
} from "@openwork/research-templates/ports"

function notConfigured(op: string): StoreError {
  return new StoreError(
    EE_NOT_CONFIGURED,
    `${op} needs Den: this project stays local. Connect Den to publish templates or assign teams.`,
  )
}

export const eeTemplateMarketplace: TemplateStore = {
  getTemplate() {
    throw notConfigured("DenTemplateMarketplace.getTemplate")
  },
  listLocal() {
    throw notConfigured("DenTemplateMarketplace.listLocal")
  },
  saveDraft() {
    throw notConfigured("DenTemplateMarketplace.saveDraft")
  },
  clone() {
    throw notConfigured("DenTemplateMarketplace.clone")
  },
  publishDraft() {
    throw notConfigured("DenTemplateMarketplace.publishDraft")
  },
  assignLocal() {
    throw notConfigured("DenTemplateMarketplace.assignLocal")
  },
}

export const eeAccessControl: AccessControl = {
  can() {
    throw notConfigured("DenAccessControl.can")
  },
}

export const eeInferenceRunner: InferenceRunner = {
  runStep() {
    throw notConfigured("ManagedInferenceRunner.runStep")
  },
}

export const eeAuditSink: AuditSink = {
  append() {
    throw notConfigured("DenAuditSink.append")
  },
  list() {
    throw notConfigured("DenAuditSink.list")
  },
}
