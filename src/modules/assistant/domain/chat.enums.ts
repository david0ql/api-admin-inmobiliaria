/** Qué falló en una respuesta, según quien la revisa. */
export enum ChatIssue {
  INCORRECT_INFO = 'INCORRECT_INFO',
  INCOMPLETE = 'INCOMPLETE',
  ROBOTIC_TONE = 'ROBOTIC_TONE',
  MISUNDERSTOOD = 'MISUNDERSTOOD',
  TOO_LONG = 'TOO_LONG',
  NO_PUSH_TO_VISIT = 'NO_PUSH_TO_VISIT',
  INVENTED = 'INVENTED',
  OTHER = 'OTHER',
}

/** Cómo se leen en el panel. El backend nunca las traduce. */
export const CHAT_ISSUE_LABEL: Record<ChatIssue, string> = {
  [ChatIssue.INCORRECT_INFO]: 'Información incorrecta',
  [ChatIssue.INCOMPLETE]: 'Respuesta incompleta',
  [ChatIssue.ROBOTIC_TONE]: 'Tono robótico',
  [ChatIssue.MISUNDERSTOOD]: 'No entendió lo que le pedían',
  [ChatIssue.TOO_LONG]: 'Demasiado larga',
  [ChatIssue.NO_PUSH_TO_VISIT]: 'No llevó a agendar',
  [ChatIssue.INVENTED]: 'Se inventó algo',
  [ChatIssue.OTHER]: 'Otra cosa',
};

/** De dónde salió una regla. */
export enum RuleSource {
  /** La escribió alguien a mano. */
  MANUAL = 'MANUAL',
  /** La redactó el modelo a partir de una calificación, y se aprobó. */
  REVIEW = 'REVIEW',
}
