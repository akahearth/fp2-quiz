export const GRADE_PREFERENCE_KEY = 'fp-trainer:grade:v1';
export const GRADES = Object.freeze({
  '2': { label: 'FP2級', bankFile: './questions.json', storageKey: 'fp2-trainer:v1', backupApp: 'fp2-study-trainer', audit: './AUDIT', minutesPerQuestion: 2, formatLabel: '4択' },
  '3': { label: 'FP3級', bankFile: './questions-fp3.json', storageKey: 'fp3-trainer:v1', backupApp: 'fp3-study-trainer', audit: './AUDIT-FP3', minutesPerQuestion: 1.5, formatLabel: '○×・3択' }
});
export function gradeConfig(grade = '2') {
  const config = GRADES[String(grade)];
  if (!config) throw new Error('対応していない級です。');
  return config;
}
export function readGrade(storage) {
  try { const grade = storage?.getItem(GRADE_PREFERENCE_KEY); return GRADES[grade] ? grade : '2'; }
  catch { return '2'; }
}
