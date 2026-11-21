import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import {
  APPROVER_ROLES,
  WORKFLOW_SCOPE_LABELS,
  WORKFLOW_SCOPE_TYPES,
  type ApproverRole,
  type WorkflowScopeType,
} from '@venue/shared';
import type { WorkflowView } from '../lib/api';
import { api, ApiError, fieldError } from '../lib/api';
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  SelectField,
  TextField,
  TextareaField,
  useToast,
} from './ui';

interface WorkflowDialogProps {
  workflow?: WorkflowView;
  onClose: () => void;
}

interface StepDraft {
  stepName: string;
  requiredRole: ApproverRole;
  scopeType: WorkflowScopeType;
  isFinalAllotmentStep: boolean;
}

const PRESETS: { label: string; steps: StepDraft[] }[] = [
  {
    label: 'HOD only',
    steps: [
      {
        stepName: 'Department HOD Review',
        requiredRole: 'HOD',
        scopeType: 'CREATOR_DEPARTMENT',
        isFinalAllotmentStep: true,
      },
    ],
  },
  {
    label: 'Principal only',
    steps: [
      {
        stepName: 'Principal Approval',
        requiredRole: 'PRINCIPAL',
        scopeType: 'COLLEGE_WIDE',
        isFinalAllotmentStep: true,
      },
    ],
  },
  {
    label: 'Bursar only',
    steps: [
      {
        stepName: 'Bursar Financial Review',
        requiredRole: 'BURSAR',
        scopeType: 'COLLEGE_WIDE',
        isFinalAllotmentStep: true,
      },
    ],
  },
  {
    label: 'HOD → Principal',
    steps: [
      {
        stepName: 'Department HOD Review',
        requiredRole: 'HOD',
        scopeType: 'CREATOR_DEPARTMENT',
        isFinalAllotmentStep: false,
      },
      {
        stepName: 'Principal Approval',
        requiredRole: 'PRINCIPAL',
        scopeType: 'COLLEGE_WIDE',
        isFinalAllotmentStep: true,
      },
    ],
  },
  {
    label: 'HOD → Bursar → Principal',
    steps: [
      {
        stepName: 'Department HOD Review',
        requiredRole: 'HOD',
        scopeType: 'CREATOR_DEPARTMENT',
        isFinalAllotmentStep: false,
      },
      {
        stepName: 'Bursar Facilities Review',
        requiredRole: 'BURSAR',
        scopeType: 'COLLEGE_WIDE',
        isFinalAllotmentStep: false,
      },
      {
        stepName: 'Principal Final Approval',
        requiredRole: 'PRINCIPAL',
        scopeType: 'COLLEGE_WIDE',
        isFinalAllotmentStep: true,
      },
    ],
  },
];

export function WorkflowDialog({ workflow, onClose }: WorkflowDialogProps) {
  const editing = Boolean(workflow);
  const stepsLocked = workflow?.stepsLocked ?? false;
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [isDefault, setIsDefault] = useState(workflow?.isDefault ?? false);
  const [steps, setSteps] = useState<StepDraft[]>(
    workflow?.steps.map((s) => ({
      stepName: s.stepName,
      requiredRole: s.requiredRole,
      scopeType: s.scopeType,
      isFinalAllotmentStep: s.isFinalAllotmentStep,
    })) ?? PRESETS[3]!.steps,
  );

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        description: description.trim() || undefined,
        isDefault,
        ...(stepsLocked ? {} : { steps }),
      };
      return workflow
        ? api.updateWorkflow(workflow.id, input)
        : api.createWorkflow({
            name: name.trim(),
            description: description.trim() || undefined,
            isDefault,
            steps,
          });
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'workflows'] }),
      ]);
      pushToast({
        tone: 'success',
        title: editing ? 'Workflow updated' : 'Workflow created',
        message: `${result.workflow.name} is ready for venues.`,
      });
      onClose();
    },
  });

  function applyPreset(presetSteps: StepDraft[]) {
    if (stepsLocked) return;
    setSteps(presetSteps);
  }

  function updateStep(index: number, patch: Partial<StepDraft>) {
    if (stepsLocked) return;
    setSteps((prev) =>
      prev.map((step, i) => {
        if (i !== index) return step;
        const updated = { ...step, ...patch };
        // Enforce: only HOD can be department-scoped
        if (updated.requiredRole !== 'HOD') {
          updated.scopeType = 'COLLEGE_WIDE';
        }
        return updated;
      }),
    );
  }

  function addStep() {
    if (stepsLocked || steps.length >= 12) return;
    setSteps((prev) => [
      ...prev.map((s) => ({ ...s, isFinalAllotmentStep: false })),
      {
        stepName: 'Review Step',
        requiredRole: 'HOD',
        scopeType: 'CREATOR_DEPARTMENT',
        isFinalAllotmentStep: true,
      },
    ]);
  }

  function removeStep(index: number) {
    if (stepsLocked || steps.length <= 1) return;
    setSteps((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Ensure last step has isFinalAllotmentStep: true
      return next.map((s, i) => ({
        ...s,
        isFinalAllotmentStep: i === next.length - 1,
      }));
    });
  }

  function moveStep(index: number, direction: 'up' | 'down') {
    if (stepsLocked) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= steps.length) return;
    setSteps((prev) => {
      const copy = [...prev];
      const temp = copy[index]!;
      copy[index] = copy[targetIndex]!;
      copy[targetIndex] = temp;
      // Ensure the last step is marked as final allotment step
      return copy.map((s, i) => ({
        ...s,
        isFinalAllotmentStep: i === copy.length - 1,
      }));
    });
  }

  const isValid =
    name.trim().length >= 2 &&
    steps.length >= 1 &&
    steps.every((s) => s.stepName.trim().length >= 2) &&
    steps[steps.length - 1]?.isFinalAllotmentStep === true;

  const errorFor = (field: string) =>
    save.error instanceof ApiError ? fieldError(save.error, field) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? 'Edit approval workflow' : 'Create approval workflow'}
      description="Define the sequential stages, roles and departmental scoping for venue booking requests."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            size="md"
            loading={save.isPending}
            disabled={!isValid}
            onClick={() => save.mutate()}
          >
            {editing ? 'Save workflow' : 'Create workflow'}
          </Button>
        </>
      }
    >
      <div className="workflow-dialog-form">
        <TextField
          label="Workflow name"
          name="workflow-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Standard Department Hall, High-Stakes Auditorium"
          maxLength={100}
          required
          error={errorFor('name')}
        />

        <TextareaField
          label="Description"
          name="workflow-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Guidance for administrators assigning this workflow to venues…"
          rows={2}
          maxLength={500}
          optional
        />

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          <span>Default approval workflow (automatically used for venues without an assigned workflow)</span>
        </label>

        {stepsLocked ? (
          <Alert tone="info" title="Steps are locked">
            This workflow has handled {workflow?.usageCount} booking request(s). To protect decision history, create a new workflow rather than changing existing steps.
          </Alert>
        ) : (
          <div className="workflow-steps-section">
            <div className="steps-section-header">
              <h4>Sequential approval steps ({steps.length})</h4>
              <div className="preset-buttons">
                <span className="preset-label">Presets:</span>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="preset-btn"
                    onClick={() => applyPreset(p.steps)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <ol className="step-builder-list">
              {steps.map((step, index) => (
                <li key={index} className="step-builder-card">
                  <div className="step-builder-order">
                    <span className="step-badge-num">{index + 1}</span>
                    <div className="step-reorder-buttons">
                      <IconButton
                        label="Move step up"
                        disabled={index === 0}
                        onClick={() => moveStep(index, 'up')}
                      >
                        <ArrowUp size={14} />
                      </IconButton>
                      <IconButton
                        label="Move step down"
                        disabled={index === steps.length - 1}
                        onClick={() => moveStep(index, 'down')}
                      >
                        <ArrowDown size={14} />
                      </IconButton>
                    </div>
                  </div>

                  <div className="step-builder-fields">
                    <div className="form-row">
                      <TextField
                        label="Step name"
                        name={`step-${index}-name`}
                        value={step.stepName}
                        onChange={(e) => updateStep(index, { stepName: e.target.value })}
                        placeholder="e.g. HOD Review, Principal Allotment"
                        required
                      />

                      <SelectField
                        label="Required role"
                        name={`step-${index}-role`}
                        value={step.requiredRole}
                        onChange={(e) =>
                          updateStep(index, { requiredRole: e.target.value as ApproverRole })
                        }
                      >
                        {APPROVER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </SelectField>
                    </div>

                    <div className="form-row">
                      <SelectField
                        label="Department scoping"
                        name={`step-${index}-scope`}
                        value={step.scopeType}
                        onChange={(e) =>
                          updateStep(index, { scopeType: e.target.value as WorkflowScopeType })
                        }
                        disabled={step.requiredRole !== 'HOD'}
                        hint={
                          step.requiredRole !== 'HOD'
                            ? 'Non-HOD approvals are college-wide.'
                            : 'Department-managed venues always route to their own HOD. This setting applies to college-wide venues.'
                        }
                      >
                        {WORKFLOW_SCOPE_TYPES.map((scope) => (
                          <option key={scope} value={scope}>
                            {WORKFLOW_SCOPE_LABELS[scope]}
                          </option>
                        ))}
                      </SelectField>

                      <div className="step-final-check">
                        <label className="checkbox-field">
                          <input
                            type="checkbox"
                            checked={step.isFinalAllotmentStep}
                            disabled={index !== steps.length - 1}
                            onChange={(e) =>
                              updateStep(index, { isFinalAllotmentStep: e.target.checked })
                            }
                          />
                          <span>Final allotment step</span>
                        </label>
                        {index === steps.length - 1 && (
                          <span className="step-hint">The final step completes preliminary review.</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {steps.length > 1 && (
                    <IconButton
                      label="Delete step"
                      className="danger-ghost"
                      onClick={() => removeStep(index)}
                    >
                      <Trash size={16} />
                    </IconButton>
                  )}
                </li>
              ))}
            </ol>

            {steps.length < 12 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={addStep}
                className="add-step-btn"
              >
                <Plus size={16} /> Add approval step
              </Button>
            )}
          </div>
        )}

        {save.isError && (
          <Alert tone="danger" title="Could not save workflow">
            {save.error instanceof ApiError
              ? save.error.message
              : 'Please check the step inputs and try again.'}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
