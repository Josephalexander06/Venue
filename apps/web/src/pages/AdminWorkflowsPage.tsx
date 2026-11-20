import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  GitBranch,
  Lock,
  Plus,
  Storefront,
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
        eyebrow="Administration"
        title="Approval workflows"
        description="Configure sequential approval pipelines, role requirements and departmental scopes for campus venues."
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
        <div className="workflow-grid" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="workflow-card">
              <Skeleton className="skeleton-line skeleton-line-wide" />
              <Skeleton className="skeleton-line" />
              <Skeleton className="skeleton-block" />
            </div>
          ))}
        </div>
      ) : workflows.length === 0 ? (
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
        <div className="workflow-grid">
          {workflows.map((wf) => (
            <article key={wf.id} className="workflow-card">
              <div className="workflow-card-head">
                <div>
                  <div className="workflow-title-row">
                    <h3>{wf.name}</h3>
                    {wf.isDefault && (
                      <span className="workflow-default-badge">College default</span>
                    )}
                  </div>
                  {wf.description && (
                    <p className="workflow-desc">{wf.description}</p>
                  )}
                </div>

                <div className="workflow-card-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setDialogTarget({ workflow: wf })}
                  >
                    Edit workflow
                  </Button>
                </div>
              </div>

              {/* Step Sequence Visualization */}
              <div className="workflow-chain-box">
                <span className="workflow-chain-label">Approval pipeline:</span>
                <ol className="workflow-chain-list">
                  {wf.steps.map((step, idx) => (
                    <li key={step.id} className="workflow-chain-node">
                      <div className="chain-node-bubble">
                        <span className="chain-step-num">{step.stepOrder}</span>
                        <div className="chain-node-text">
                          <strong>{step.stepName}</strong>
                          <span>
                            {ROLE_LABELS[step.requiredRole]} · {WORKFLOW_SCOPE_LABELS[step.scopeType]}
                          </span>
                        </div>
                        {step.isFinalAllotmentStep && (
                          <span className="chain-final-tag">Final Allotment</span>
                        )}
                      </div>
                      {idx < wf.steps.length - 1 && (
                        <ArrowRight size={16} className="chain-arrow" aria-hidden="true" />
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="workflow-meta-row">
                <span className="workflow-meta-stat">
                  <Storefront size={16} /> Assigned to <strong>{wf.venueCount}</strong> venue(s)
                </span>
                <span className="workflow-meta-stat">
                  <GitBranch size={16} /> Used in <strong>{wf.usageCount}</strong> booking request(s)
                </span>
                {wf.stepsLocked && (
                  <span className="workflow-meta-stat is-locked" title="Steps are immutable because this workflow has recorded request history">
                    <Lock size={15} /> Steps locked (in use)
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
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
