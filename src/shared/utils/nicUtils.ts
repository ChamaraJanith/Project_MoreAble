/**
 * Sri Lankan NIC Utility Functions
 * Supports both Old NIC (9 digits + V/X) and New NIC (12 digits)
 */

export interface NicInfo {
  isValid: boolean;
  nicNumber: string;
  birthYear?: number;
  birthDate?: Date;
  age?: number;
  gender?: 'MALE' | 'FEMALE';
  isElderly?: boolean; // Age >= 60
}

/**
 * Days in each month (non-leap year baseline used in SL NIC calculation)
 */
const MONTH_DAYS = [
  { month: 1, name: 'January', days: 31 },
  { month: 2, name: 'February', days: 29 }, // NIC system considers Feb as 29 days
  { month: 3, name: 'March', days: 31 },
  { month: 4, name: 'April', days: 30 },
  { month: 5, name: 'May', days: 31 },
  { month: 6, name: 'June', days: 30 },
  { month: 7, name: 'July', days: 31 },
  { month: 8, name: 'August', days: 31 },
  { month: 9, name: 'September', days: 30 },
  { month: 10, name: 'October', days: 31 },
  { month: 11, name: 'November', days: 30 },
  { month: 12, name: 'December', days: 31 },
];

export function parseSriLankanNic(nic: string, elderlyAgeThreshold = 60): NicInfo {
  const cleanNic = nic.trim().toUpperCase();

  let year: number;
  let dayOfYear: number;
  let gender: 'MALE' | 'FEMALE';

  // Old NIC format: 9 digits + V/X (e.g., 921234567V)
  const oldNicPattern = /^([0-9]{9})[VX]$/;
  // New NIC format: 12 digits (e.g., 199212345678)
  const newNicPattern = /^[0-9]{12}$/;

  if (oldNicPattern.test(cleanNic)) {
    year = parseInt('19' + cleanNic.substring(0, 2), 10);
    dayOfYear = parseInt(cleanNic.substring(2, 5), 10);
  } else if (newNicPattern.test(cleanNic)) {
    year = parseInt(cleanNic.substring(0, 4), 10);
    dayOfYear = parseInt(cleanNic.substring(4, 7), 10);
  } else {
    return { isValid: false, nicNumber: nic };
  }

  // Determine Gender
  if (dayOfYear > 500) {
    gender = 'FEMALE';
    dayOfYear -= 500;
  } else {
    gender = 'MALE';
  }

  if (dayOfYear < 1 || dayOfYear > 366) {
    return { isValid: false, nicNumber: nic };
  }

  // Calculate Month & Day
  let month = 0;
  let day = dayOfYear;

  for (let i = 0; i < MONTH_DAYS.length; i++) {
    if (day <= MONTH_DAYS[i].days) {
      month = MONTH_DAYS[i].month;
      break;
    }
    day -= MONTH_DAYS[i].days;
  }

  const birthDate = new Date(year, month - 1, day);
  const today = new Date();
  
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() - (month - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age--;
  }

  return {
    isValid: true,
    nicNumber: cleanNic,
    birthYear: year,
    birthDate,
    age,
    gender,
    isElderly: age >= elderlyAgeThreshold,
  };
}
