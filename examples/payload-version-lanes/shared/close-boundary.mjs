/**
 * Describe already observed owned groups at the child's stdio-close boundary.
 * PID/start identities distinguish tracked members from reuse; state and a
 * signal probe are observations only and never weaken the stop decision.
 */
export function closeBoundarySnapshot(groups, table, probeAlive, observedAt, rawExit) {
  return {
    observedAt,
    rawExit,
    groups: [...groups.values()].map((owned) => {
      const members = table
        .filter((member) => member.group === owned.group)
        .map((member) => ({
          pid: member.pid,
          parent: member.parent,
          group: member.group,
          start: member.start,
          state: member.state,
          positivelyObserved: owned.members.get(member.pid) === member.start,
        }));
      return {
        group: owned.group,
        signalProbeAlive: probeAlive(owned.group),
        members,
        positiveMembers: members.filter((member) => member.positivelyObserved).length,
        nonZombieMembers: members.filter((member) => member.state !== 'Z').length,
      };
    }),
  };
}
