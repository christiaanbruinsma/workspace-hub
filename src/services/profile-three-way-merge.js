function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(left, right) {
  if (Object.is(left, right))
    return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
      return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right))
      return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return deepEqual(leftKeys, rightKeys)
      && leftKeys.every(key => deepEqual(left[key], right[key]));
  }
  return false;
}

function mergeValue(baseline, desired, latest, path) {
  if (deepEqual(desired, baseline))
    return clone(latest);
  if (deepEqual(latest, baseline))
    return clone(desired);
  if (deepEqual(latest, desired))
    return clone(latest);

  if (isPlainObject(baseline) && isPlainObject(desired) && isPlainObject(latest)) {
    const merged = {};
    const keys = new Set([...Object.keys(baseline), ...Object.keys(desired), ...Object.keys(latest)]);
    for (const key of keys)
      merged[key] = mergeValue(baseline[key], desired[key], latest[key], `${path}.${key}`);
    return merged;
  }

  throw new Error(`Workspace changed concurrently at ${path}`);
}

export function mergeProfileUpdate(baseline, desired, latest) {
  if (!isPlainObject(baseline) || !isPlainObject(desired) || !isPlainObject(latest))
    throw new Error('Profile merge requires three profile objects');
  return mergeValue(baseline, desired, latest, 'profile');
}
