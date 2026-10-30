-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "size" INTEGER;

-- CreateTable
CREATE TABLE "DocumentExtraction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "documentType" TEXT,
    "classificationMethod" TEXT,
    "extractionMethod" TEXT,
    "ocrStatus" TEXT NOT NULL DEFAULT 'not_required',
    "malwareScanStatus" TEXT NOT NULL DEFAULT 'not_scanned',
    "provider" TEXT,
    "model" TEXT,
    "extractedText" TEXT,
    "fields" JSONB,
    "warnings" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFinding" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "extractionId" TEXT,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "field" TEXT,
    "observed" JSONB,
    "expected" JSONB,
    "message" TEXT NOT NULL,
    "suggestedAction" TEXT,
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "sourceDocumentIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DECIMAL(12,6),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "sources" JSONB,
    "suggestedActions" JSONB,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentRiskAssessment" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "dataCompleteness" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentRiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentDelayEstimate" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "estimatedDelayDays" DOUBLE PRECISION,
    "minDelayDays" DOUBLE PRECISION,
    "maxDelayDays" DOUBLE PRECISION,
    "riskCategory" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "dataCompleteness" INTEGER NOT NULL,
    "factors" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentDelayEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentExtraction_documentId_key" ON "DocumentExtraction"("documentId");

-- CreateIndex
CREATE INDEX "DocumentExtraction_organizationId_createdAt_idx" ON "DocumentExtraction"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentExtraction_status_idx" ON "DocumentExtraction"("status");

-- CreateIndex
CREATE INDEX "DocumentExtraction_documentType_idx" ON "DocumentExtraction"("documentType");

-- CreateIndex
CREATE INDEX "DocumentFinding_shipmentId_severity_idx" ON "DocumentFinding"("shipmentId", "severity");

-- CreateIndex
CREATE INDEX "DocumentFinding_documentId_idx" ON "DocumentFinding"("documentId");

-- CreateIndex
CREATE INDEX "DocumentFinding_organizationId_createdAt_idx" ON "DocumentFinding"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentFinding_code_idx" ON "DocumentFinding"("code");

-- CreateIndex
CREATE INDEX "AiExecution_organizationId_createdAt_idx" ON "AiExecution"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiExecution_operation_status_idx" ON "AiExecution"("operation", "status");

-- CreateIndex
CREATE INDEX "CopilotConversation_organizationId_userId_updatedAt_idx" ON "CopilotConversation"("organizationId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CopilotMessage_conversationId_createdAt_idx" ON "CopilotMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ShipmentRiskAssessment_shipmentId_createdAt_idx" ON "ShipmentRiskAssessment"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ShipmentRiskAssessment_organizationId_createdAt_idx" ON "ShipmentRiskAssessment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ShipmentDelayEstimate_shipmentId_computedAt_idx" ON "ShipmentDelayEstimate"("shipmentId", "computedAt");

-- CreateIndex
CREATE INDEX "ShipmentDelayEstimate_organizationId_computedAt_idx" ON "ShipmentDelayEstimate"("organizationId", "computedAt");

-- AddForeignKey
ALTER TABLE "DocumentExtraction" ADD CONSTRAINT "DocumentExtraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtraction" ADD CONSTRAINT "DocumentExtraction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFinding" ADD CONSTRAINT "DocumentFinding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFinding" ADD CONSTRAINT "DocumentFinding_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "DocumentExtraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFinding" ADD CONSTRAINT "DocumentFinding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFinding" ADD CONSTRAINT "DocumentFinding_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExecution" ADD CONSTRAINT "AiExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiExecution" ADD CONSTRAINT "AiExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotConversation" ADD CONSTRAINT "CopilotConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotConversation" ADD CONSTRAINT "CopilotConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotMessage" ADD CONSTRAINT "CopilotMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "CopilotConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentRiskAssessment" ADD CONSTRAINT "ShipmentRiskAssessment_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentRiskAssessment" ADD CONSTRAINT "ShipmentRiskAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDelayEstimate" ADD CONSTRAINT "ShipmentDelayEstimate_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentDelayEstimate" ADD CONSTRAINT "ShipmentDelayEstimate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

