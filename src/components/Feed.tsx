import { useMemo } from 'react';
import { describe, groupFeed, timeAgo } from '../lib/activity';
import type { ActivityEvent, Household } from '../types';
import { Avatar } from './ui';

export function Feed({ household, events }: { household: Household; events: ActivityEvent[] }) {
  const groups = useMemo(() => groupFeed(events), [events]);
  return (
    <section className="feed">
      <h1 className="screen-title">Us</h1>
      <p className="muted">Everything either of you changes, newest first.</p>
      {groups.length === 0 && (
        <p className="empty">Nothing yet. Add an item and it shows up here.</p>
      )}
      <ol className="events">
        {groups.map((g) => {
          const member = household.members[g.actorId];
          return (
            <li key={g.key} className="ev">
              <Avatar member={member} size={28} />
              <div className="ev-body">
                <div className="ev-line">
                  <b>{describe(g, member)}</b>
                  <time className="when" dateTime={new Date(g.at).toISOString()}>
                    {timeAgo(g.at)}
                  </time>
                </div>
                {g.count > 1 && (
                  <div className="pills">
                    {g.itemNames.map((n, i) => (
                      <span className="pill" key={`${n}-${i}`} style={{ color: member?.color }}>
                        {n}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
