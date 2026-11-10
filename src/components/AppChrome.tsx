import { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady, refreshApp } from '../pwa';
import { PULL_TRIGGER, usePullToRefresh } from '../usePullToRefresh';

/** Pull-to-refresh indicator and the "new version" banner. */
export function AppChrome() {
  const { pull, refreshing } = usePullToRefresh(() => void refreshApp());
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => onUpdateReady(setUpdateReady), []);

  const ready = pull >= PULL_TRIGGER;
  return (
    <>
      {(pull > 0 || refreshing) && (
        <div
          className="ptr"
          style={{ transform: `translate(-50%, ${pull - 44}px)` }}
          role="status"
          aria-live="polite"
        >
          <span
            className={`ptr-arrow${ready ? ' up' : ''}${refreshing ? ' spin' : ''}`}
            aria-hidden="true"
          >
            {refreshing ? '↻' : '↓'}
          </span>
          {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}
      {updateReady && (
        <div className="update-banner" role="status">
          <span>A new version of Fridgeboard is ready.</span>
          <button className="btn small" onClick={applyUpdate}>
            Update
          </button>
        </div>
      )}
    </>
  );
}
