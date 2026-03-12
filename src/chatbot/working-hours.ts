/**
 * Working Hours Module
 * Checks if current time is within department working hours (Turkey timezone)
 */

interface Schedule {
  start: number; // Hour (e.g., 9)
  end: number;   // Hour (e.g., 17 or 17.5 for 17:30)
  weekends: boolean;
}

const SCHEDULES: Record<string, Schedule> = {
  online:   { start: 9, end: 17,   weekends: false },
  uygulama: { start: 9, end: 17.5, weekends: false },
  genel:    { start: 9, end: 17,   weekends: false },
};

/**
 * Get current time in Turkey timezone
 */
function getTurkeyNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
}

/**
 * Check if current time is within working hours for a department
 */
export function isWithinWorkingHours(department: string): boolean {
  const schedule = SCHEDULES[department] || SCHEDULES.genel;
  const now = getTurkeyNow();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours() + now.getMinutes() / 60;

  // Weekend check
  if (!schedule.weekends && (day === 0 || day === 6)) {
    return false;
  }

  return hour >= schedule.start && hour < schedule.end;
}

/**
 * Get a user-friendly message when outside working hours
 */
export function getOfflineMessage(department: string): string {
  const schedule = SCHEDULES[department] || SCHEDULES.genel;
  const endHour = Math.floor(schedule.end);
  const endMin = (schedule.end % 1) * 60;
  const endStr = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;
  const startStr = `${String(schedule.start).padStart(2, '0')}:00`;

  return (
    `⏰ Şu anda çalışma saatleri dışındayız.\n\n` +
    `📅 Çalışma saatlerimiz:\n` +
    `Pazartesi - Cuma: ${startStr} - ${endStr}\n\n` +
    `Mesajınızı bırakabilirsiniz, en kısa sürede dönüş yapılacaktır. 🙏`
  );
}

/**
 * Get schedule info for a department
 */
export function getScheduleInfo(department: string): Schedule {
  return SCHEDULES[department] || SCHEDULES.genel;
}
