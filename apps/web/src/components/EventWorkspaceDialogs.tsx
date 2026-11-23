import type { EventView } from '../lib/api';
import { ApiError, fieldError } from '../lib/api';
import { Alert, Button, Dialog, TextField, TextareaField } from './ui';

export interface EditTarget {
  event?: EventView;
  title: string;
  description: string;
  attendance: string;
}

export interface CancelTarget {
  type: 'event' | 'request' | 'booking';
  id: string;
  label: string;
}

export function EventWorkspaceDialogs({
  editTarget, setEditTarget, closeEditor, saving, saveError, onSave,
  cancelTarget, closeCancel, cancelling, cancelError, onCancel,
}: {
  editTarget: EditTarget | null;
  setEditTarget: (target: EditTarget) => void;
  closeEditor: () => void;
  saving: boolean;
  saveError: Error | null;
  onSave: (target: EditTarget) => void;
  cancelTarget: CancelTarget | null;
  closeCancel: () => void;
  cancelling: boolean;
  cancelError: Error | null;
  onCancel: (target: CancelTarget) => void;
}) {
  return <>
      <Dialog
        open={Boolean(editTarget)}
        onClose={closeEditor}
        title={editTarget?.event ? 'Edit event details' : 'Create an event'}
        description={editTarget?.event
          ? 'To change a date or venue, update the booking separately.'
          : 'Save an event now and request a venue when you are ready.'}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={closeEditor}>
              Cancel
            </Button>
            <Button
              size="md"
              type="submit"
              form="event-editor"
              loading={saving}
              disabled={saving}
            >
              {editTarget?.event ? 'Save changes' : 'Create event'}
            </Button>
          </>
        }
      >
        {editTarget && (
          <form id="event-editor" className="dialog-form" onSubmit={(event) => {
            event.preventDefault();
            onSave(editTarget);
          }}>
            <TextField
              label="Event title"
              name="event-title"
              value={editTarget.title}
              onChange={(change) =>
                setEditTarget({ ...editTarget, title: change.target.value })
              }
              minLength={3}
              maxLength={200}
              error={fieldError(saveError, 'title')}
              required
            />
            <TextareaField
              label="Description"
              name="event-description"
              value={editTarget.description}
              onChange={(change) =>
                setEditTarget({ ...editTarget, description: change.target.value })
              }
              rows={4}
              maxLength={2000}
              optional
            />
            <TextField
              label="Expected attendance"
              name="event-attendance"
              type="number"
              min={1}
              max={100000}
              value={editTarget.attendance}
              error={fieldError(saveError, 'expectedAttendance')}
              onChange={(change) =>
                setEditTarget({ ...editTarget, attendance: change.target.value })
              }
              required
            />
            {Boolean(saveError) && (
              <Alert tone="danger" title="Could not save event">
                {saveError instanceof ApiError ? saveError.message : 'Check the details and try again.'}
              </Alert>
            )}
          </form>
        )}
      </Dialog>

      <Dialog
        open={Boolean(cancelTarget)}
        onClose={() => closeCancel()}
        title={`Cancel this ${cancelTarget?.type ?? 'event'}?`}
        description={
          cancelTarget?.type === 'event'
            ? 'This also cancels every open booking request for the event.'
            : cancelTarget?.type === 'booking'
              ? 'The reserved slot is released. If this is the last booking, the event is also cancelled.'
              : 'If this is the last request, the event is also cancelled.'
        }
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => closeCancel()}>
              Keep {cancelTarget?.type}
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={cancelling}
              onClick={() => cancelTarget && onCancel(cancelTarget)}
            >
              Cancel {cancelTarget?.type}
            </Button>
          </>
        }
      >
        <p className="dialog-confirm-copy">
          {cancelTarget?.label} will be marked as cancelled. This cannot be undone.
        </p>
        {Boolean(cancelError) && (
          <Alert tone="danger" title="Could not cancel">
            {cancelError instanceof ApiError ? cancelError.message : 'Try again.'}
          </Alert>
        )}
      </Dialog>

  </>;
}
