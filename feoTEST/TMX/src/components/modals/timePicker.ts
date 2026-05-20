/**
 * Time picker modal with 12-hour clock format.
 * Uses timepicker-ui library with accept callback and time format conversion.
 */
import { isFunction } from 'functions/typeOf';
import { TimepickerUI } from 'timepicker-ui';

function getTimepickerTheme(): { theme: 'dark' } | undefined {
  return document.documentElement.dataset.theme === 'dark' ? { theme: 'dark' } : undefined;
}

type TimePickerParams = {
  time?: string;
  options?: any;
  callback?: (result: { time: string }) => void;
};

export function timePicker({ time, options, callback }: TimePickerParams = {}): void {
  const timeValue = document.getElementById('timevalue') as HTMLInputElement;
  timeValue.value = regularTime(time);
  const tpu = new TimepickerUI(document.getElementById('timepicker')!, {
    clock: { type: '24h' },
    ui: getTimepickerTheme(),
    behavior: { autoSwitchToMinutes: true },
    callbacks: {
      onConfirm: () => {
        const value = timeValue.value;
        if (isFunction(callback) && callback) {
          callback({ time: value });
        }
        tpu.destroy();
      },
    },
    ...options,
  });
  tpu.create();
  tpu.open();
}

function regularTime(value?: string, env?: any): string {
  const time = splitTime(value || env?.schedule?.default_time);
  // Return 24h format: HH:MM
  if (time.ampm) {
    // Convert from 12h to 24h
    let h = Number(time.hours);
    if (time.ampm === 'PM' && h !== 12) h += 12;
    if (time.ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${time.minutes || '00'}`;
  }
  return `${time.hours.padStart(2, '0')}:${time.minutes || '00'}`;
}

function splitTime(value: string = '00:00'): { hours: string; minutes: string; ampm?: string } {
  const parts = value?.split(' ') || [];
  const timeParts = parts[0]?.split(':') || [];
  return {
    hours: timeParts[0] || '00',
    minutes: timeParts[1] || '00',
    ampm: parts[1],
  };
}
