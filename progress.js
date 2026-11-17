"use strict";

const temporaryProgress = new Map();

function progressKey(mode) {
  return `tarkov-keep-progress-${mode}`;
}

function completedRequirements(mode) {
  if (temporaryProgress.has(mode)) return new Set(temporaryProgress.get(mode));
  try {
    const value = JSON.parse(localStorage.getItem(progressKey(mode)));
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set(temporaryProgress.get(mode));
  }
}

function setCompletedRequirement(mode, group, checked) {
  const completed = completedRequirements(mode);
  if (checked) completed.add(group);
  else completed.delete(group);

  try {
    localStorage.setItem(progressKey(mode), JSON.stringify([...completed]));
  } catch {
    temporaryProgress.set(mode, completed);
  }
}
