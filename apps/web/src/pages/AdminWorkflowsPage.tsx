import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GitBranch,
  Lock,
  Plus,
} from '@phosphor-icons/react';
import { ROLE_LABELS, WORKFLOW_SCOPE_LABELS } from '@venue/shared';
import type { WorkflowView } from '../lib/api';
import { api } from '../lib/api';
import { usePageTitle } from '../auth';
import {
  Alert,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
} from '../components/ui';
import { WorkflowDialog } from '../components/WorkflowDialog';

export function AdminWorkflowsPage() {
  usePageTitle('Workflow configurations');
  const [dialogTarget, setDialogTarget] = useState<{ workflow?: WorkflowView } | null>(null);

  const workflowsQuery = useQuery({
    queryKey: ['admin', 'workflows'],
    queryFn: api.adminWorkflows,
  });

  const workflows = workflowsQuery.data?.workflows ?? [];

  return (
    <>
      <PageHeader
        title="Approval steps"
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => setDialogTarget({})}
          >
            <Plus size={17} /> Add workflow
          </Button>
        }
      />

      {workflowsQuery.isError && (
        <div className="page-alert">
          <Alert tone="danger" title="Could not load workflows">
            Check your connection and{' '}
            <button
              type="button"
              className="inline-link"
              onClick={() => void workflowsQuery.refetch()}
            >
              try again
            </button>
            .
          </Alert>
        </div>
      )}

      {workflowsQuery.isPending ? (
        <div className="workflow-directory" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="workflow-card">
              <Skeleton className="skeleton-line skeleton-line-wide" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-block" />
            </div>
          ))}
        </div>
      ) : workflowsQuery.isError ? null : workflows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<GitBranch size={32} weight="duotone" />}
            title="No workflows configured"
            description="Create approval workflows to govern how booking requests are reviewed and approved."
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setDialogTarget({})}
              >
                Create first workflow
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="card workflow-directory" aria-label="Configured workflows">
          {workflows.map((workflow) => (
            <li className="workflow-record" key={workflow.id}>
              <div className="workflow-record-head">
                <div>
                  <h2>{workflow.name}</h2>
                  <p>
                    {workflow.isDefault && 'College default · '}
                    {workflow.venueCount} {workflow.venueCount === 1 ? 'venue' : 'venues'} · {' '}
                    {workflow.usageCount} {workflow.usageCount === 1 ? 'request' : 'requests'}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setDialogTarget({ workflow })}>
                  Edit workflow
                </Button>
              </div>
              {workflow.description && <p className="workflow-desc">{workflow.description}</p>}
              <details className="workflow-stage-details">
                <summary>
                  {workflow.steps.length} approval {workflow.steps.length === 1 ? 'step' : 'steps'}
                  {workflow.stepsLocked && <span><Lock size={14} aria-hidden="true" /> Steps locked</span>}
                </summary>
                <ol>
                  {workflow.steps.map((step) => (
                    <li key={step.id}>
                      <div>
                        <strong>{step.stepName}</strong>
                        <span>{ROLE_LABELS[step.requiredRole]} · {WORKFLOW_SCOPE_LABELS[step.scopeType]}</span>
                      </div>
                      {step.isFinalAllotmentStep && <span>Final allotment</span>}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}

      {dialogTarget && (
        <WorkflowDialog
          workflow={dialogTarget.workflow}
          onClose={() => setDialogTarget(null)}
        />
      )}
    </>
  );
}
