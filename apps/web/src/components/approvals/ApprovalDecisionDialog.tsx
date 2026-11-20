import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Prohibit, WarningCircle } from '@phosphor-icons/react';
import type { ApprovalDecision } from '@venue/shared';
import { api, ApiError, fieldError } from '../../lib/api';
import { Alert, Button, Dialog, TextareaField, useToast } from '../ui';

interface ApprovalDecisionDialogProps {
  requestId: string;
  stepName: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ApprovalDecisionDialog({
  requestId,
  stepName,
  onClose,
  onSuccess,
}: ApprovalDecisionDialogProps) {
  const [decision, setDecision] = useState<ApprovalDecision>('APPROVED');
  const [comments, setComments] = useState('');
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const decide = useMutation({
    mutationFn: () =>
      api.decideApproval(requestId, {
        decision,
        comments: comments.trim() || undefined,
      }),
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['approvals'] }),
        queryClient.invalidateQueries({ queryKey: ['approval', requestId] }),
        queryClient.invalidateQueries({ queryKey: ['my-events'] }),
        queryClient.invalidateQueries({ queryKey: ['venue-calendar'] }),
      ]);
      pushToast({
        tone: decision === 'APPROVED' ? 'success' : decision === 'REJECTED' ? 'danger' : 'info',
        title:
          decision === 'APPROVED'
            ? 'Request approved'
            : decision === 'REJECTED'
              ? 'Request rejected'
              : 'Changes requested',
        message:
          data.outcome.status === 'APPROVED_PENDING_ALLOTMENT'
            ? 'All preliminary approvals are complete. Awaiting final venue allotment.'
            : data.outcome.status === 'IN_REVIEW'
              ? 'Request advanced to the next review step.'
              : data.outcome.status === 'SUBMITTED'
                ? 'Request returned to the organizer for changes.'
                : 'The booking request was rejected.',
      });
      onSuccess?.();
      onClose();
    },
  });

  const isCommentRequired = decision !== 'APPROVED';
  const commentValid = !isCommentRequired || comments.trim().length >= 5;

  const errorFor = (field: string) =>
    decide.error instanceof ApiError ? fieldError(decide.error, field) : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record approval decision"
      description={`Stage: ${stepName}. Choose your decision and provide remarks if needed.`}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={decide.isPending}>
            Cancel
          </Button>
          <Button
            size="md"
            variant={
              decision === 'APPROVED'
                ? 'primary'
                : decision === 'REJECTED'
                  ? 'danger'
                  : 'secondary'
            }
            loading={decide.isPending}
            disabled={!commentValid}
            onClick={() => decide.mutate()}
          >
            {decision === 'APPROVED'
              ? 'Approve stage'
              : decision === 'REJECTED'
                ? 'Reject request'
                : 'Request changes'}
          </Button>
        </>
      }
    >
      <div className="decision-form">
        <fieldset className="decision-options">
          <legend className="decision-legend">Your decision</legend>

          <label
            htmlFor="decision-approved"
            className={`decision-option ${decision === 'APPROVED' ? 'is-selected is-approved' : ''}`}
            aria-label="Approve"
          >
            <input
              id="decision-approved"
              type="radio"
              name="decision"
              value="APPROVED"
              checked={decision === 'APPROVED'}
              onChange={() => setDecision('APPROVED')}
            />
            <span className="decision-option-content">
              <span className="decision-option-title">
                <CheckCircle size={18} weight="fill" /> Approve
              </span>
              <span className="decision-option-desc">
                Advances the request to the next workflow step or marks it ready for final allotment.
              </span>
            </span>
          </label>

          <label
            htmlFor="decision-changes"
            className={`decision-option ${decision === 'CHANGES_REQUESTED' ? 'is-selected is-changes' : ''}`}
            aria-label="Request changes"
          >
            <input
              id="decision-changes"
              type="radio"
              name="decision"
              value="CHANGES_REQUESTED"
              checked={decision === 'CHANGES_REQUESTED'}
              onChange={() => setDecision('CHANGES_REQUESTED')}
            />
            <span className="decision-option-content">
              <span className="decision-option-title">
                <WarningCircle size={18} weight="fill" /> Request changes
              </span>
              <span className="decision-option-desc">
                Returns the request to the organizer to update details. Re-starts from this stage.
              </span>
            </span>
          </label>

          <label
            htmlFor="decision-rejected"
            className={`decision-option ${decision === 'REJECTED' ? 'is-selected is-rejected' : ''}`}
            aria-label="Reject"
          >
            <input
              id="decision-rejected"
              type="radio"
              name="decision"
              value="REJECTED"
              checked={decision === 'REJECTED'}
              onChange={() => setDecision('REJECTED')}
            />
            <span className="decision-option-content">
              <span className="decision-option-title">
                <Prohibit size={18} weight="fill" /> Reject
              </span>
              <span className="decision-option-desc">
                Denies the request and halts the approval process permanently.
              </span>
            </span>
          </label>
        </fieldset>

        <TextareaField
          label={
            decision === 'APPROVED'
              ? 'Comments (optional)'
              : decision === 'REJECTED'
                ? 'Rejection reason (required)'
                : 'Changes requested (required)'
          }
          name="approval-comments"
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          placeholder={
            decision === 'APPROVED'
              ? 'Add any conditions, notes or guidance for subsequent approvers…'
              : decision === 'REJECTED'
                ? 'Explain why this venue booking cannot be approved…'
                : 'Describe what the organizer must update (e.g. adjust timing, clarify attendance)…'
          }
          rows={3}
          maxLength={1000}
          required={isCommentRequired}
          error={errorFor('comments')}
          hint={
            isCommentRequired && comments.trim().length < 5
              ? 'At least 5 characters required.'
              : undefined
          }
        />

        {decide.isError && (
          <Alert tone="danger" title="Could not record decision">
            {decide.error instanceof ApiError
              ? decide.error.message
              : 'Please check your connection and try again.'}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
