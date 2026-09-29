# Finding Reassignment Workflow

## Overview
The Finding Reassignment Workflow (#1035) enables engineering organizations to dynamically reassign static analysis findings across teams, modules, and developers. It provides:
- Immutable audit logging for compliance and tracking
- Multi-tenant boundary isolation
- Optimistic concurrency control to prevent race conditions
- Bulk reassignment for organizational team transfers
- Operational metrics and structured logging

---

## Architecture & Data Model

### Finding Model Extensions
Findings maintain assignment state within `Finding`:
- `assignedTo`: Identifier of the responsible user, team, or module
- `assignedBy`: Actor who performed the last assignment/reassignment
- `reassignedAt`: ISO 8601 timestamp of the reassignment
- `reassignmentCount`: Total number of reassignments performed on the finding

### Audit Record Schema
Every reassignment generates an immutable `ReassignmentRecord`:
```typescript
interface ReassignmentRecord {
  id: string; // reas_...
  findingId: string;
  organizationId: string;
  previousAssignee?: string;
  newAssignee: string;
  reassignedBy: string;
  reason: string;
  timestamp: number; // epoch ms or ISO string
  metadata?: Record<string, unknown>;
}
```

---

## API Endpoints

### 1. Reassign Single Finding
- **Path**: `POST /findings/:id/reassign`
- **Headers**:
  - `x-organization-id`: Tenant ID
- **Request Body**:
```json
{
  "newAssignee": "team-token-core",
  "reassignedBy": "auditor-alice",
  "reason": "Transferred for Soroban storage optimization remediation",
  "expectedPreviousAssignee": "team-triage",
  "metadata": { "ticketRef": "SEC-1049" }
}
```
- **Response**: `200 OK`
```json
{
  "data": {
    "finding": {
      "id": "fnd_...",
      "assignedTo": "team-token-core",
      "assignedBy": "auditor-alice",
      "reassignedAt": "2026-09-29T14:00:00.000Z",
      "reassignmentCount": 1
    },
    "record": {
      "id": "reas_...",
      "findingId": "fnd_...",
      "previousAssignee": "team-triage",
      "newAssignee": "team-token-core",
      "reassignedBy": "auditor-alice",
      "reason": "Transferred for Soroban storage optimization remediation",
      "timestamp": "2026-09-29T14:00:00.000Z"
    }
  }
}
```

### 2. Batch Reassign Findings
- **Path**: `POST /findings/reassign`
- **Headers**:
  - `x-organization-id`: Tenant ID
- **Request Body**:
```json
{
  "findingIds": ["fnd_1", "fnd_2", "fnd_3"],
  "newAssignee": "devops-team",
  "reassignedBy": "lead-architect",
  "reason": "Bulk transfer for infrastructure gas optimization"
}
```
- **Response**: `200 OK`
```json
{
  "data": {
    "total": 3,
    "successful": 3,
    "failed": 0,
    "records": [ ... ],
    "errors": []
  }
}
```

### 3. Retrieve Reassignment Audit Trail
- **Path**: `GET /findings/:id/reassignments`
- **Headers**:
  - `x-organization-id`: Tenant ID
- **Response**: `200 OK`
```json
{
  "data": [
    {
      "id": "reas_1",
      "previousAssignee": "team-triage",
      "newAssignee": "team-token-core",
      "reassignedBy": "auditor-alice",
      "reason": "Initial triage",
      "timestamp": "2026-09-29T13:00:00.000Z"
    },
    {
      "id": "reas_2",
      "previousAssignee": "team-token-core",
      "newAssignee": "developer-bob",
      "reassignedBy": "team-token-core",
      "reason": "Assigned to individual developer",
      "timestamp": "2026-09-29T14:00:00.000Z"
    }
  ]
}
```

---

## Policy & Validation Rules

| Rule | Default | Description |
|---|---|---|
| `requireReason` | `true` | Requires non-empty justification for any reassignment |
| `minReasonLength` | `5` characters | Prevents trivial or empty reasons |
| `allowReassignmentToCurrent` | `false` | Rejects no-op reassignments (`ALREADY_ASSIGNED` 409) |
| `maxBatchSize` | `100` | Limits batch size to prevent starvation and DOS |
| `allowedAssignees` | Optional whitelist | Restricts target assignees to approved teams |
| Concurrency Guard | `expectedPreviousAssignee` | Detects concurrent edits (`CONCURRENCY_CONFLICT` 409) |
| Tenant Boundary | `organizationId` | Strictly prevents cross-tenant access or leaks |

---

## Operational Metrics & Logging

The workflow exports the following counters:
- `totalRequests`: Total inbound reassignment requests
- `successfulReassignments`: Count of successful transfers
- `failedReassignments`: Count of rejected or failed operations
- `reassignmentsByAssignee`: Frequency breakdown by target assignee
- `reassignmentsByActor`: Activity breakdown by initiating actor

Structured JSON log events:
- `finding.reassigned` (level: `info`)
- `finding.reassignment_failed` (level: `warn`)
Logs include tenant ID, finding ID, actors, and reasons without exposing secrets, credentials, or customer PII.
