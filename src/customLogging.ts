import { Logger, LogLevel } from "homebridge";
import { format } from "date-fns";

export const logLevelNumeric: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 1,
  [LogLevel.INFO]: 2,
  [LogLevel.SUCCESS]: 3,
  [LogLevel.WARN]: 4,
  [LogLevel.ERROR]: 5,
};

export const logLevelFromString: Record<string, LogLevel> = {
  ["debug"]: LogLevel.DEBUG,
  ["info"]: LogLevel.INFO,
  ["success"]: LogLevel.SUCCESS,
  ["warn"]: LogLevel.WARN,
  ["error"]: LogLevel.ERROR,
};

export class ConsoleLogger {
  public readonly prefix: string | undefined;
  public readonly logLevel: number;
  public readonly datetimePrefix: boolean;

  /**
   * @param prefix shown in cyan like the prefix of the Homebridge log, so the Homebridge UI
   *   ("Plugin Logs") recognizes the lines as lines of this plugin
   */
  constructor(logLevel: LogLevel, prefix?: string, datetimePrefix = false) {
    this.prefix = prefix;
    this.datetimePrefix = datetimePrefix;

    this.logLevel = logLevelNumeric[logLevel];
  }

  log(level: LogLevel, message: string, ...parameters: any[]): void {
    if (this.logLevel <= logLevelNumeric[level]) {
      let fullMessage;
      if (this.prefix) {
        const prefix = `\x1b[36m[${this.prefix}]\x1b[39m`;
        fullMessage = this.datetimePrefix
          ? `[${format(new Date(), "M/d/yyyy, h:mm:ss a")}] ${prefix} ${message}`
          : `${prefix} ${message}`;
      } else {
        fullMessage = this.datetimePrefix
          ? `[${format(new Date(), "M/d/yyyy, h:mm:ss a")}] ${message}`
          : message;
      }

      console.log(fullMessage, ...parameters);
    }
  }

  debug(message: string, ...parameters: any[]): void {
    this.log(LogLevel.DEBUG, message, ...parameters);
  }

  info(message: string, ...parameters: any[]): void {
    this.log(LogLevel.INFO, message, ...parameters);
  }

  success(message: string, ...parameters: any[]): void {
    this.log(LogLevel.SUCCESS, message, ...parameters);
  }

  warn(message: string, ...parameters: any[]): void {
    this.log(LogLevel.WARN, message, ...parameters);
  }

  error(message: string, ...parameters: any[]): void {
    this.log(LogLevel.ERROR, message, ...parameters);
  }
}

export class LoggerPrefixWrapper {
  private readonly logger: Logger;
  public readonly prefix: string | undefined;
  public readonly additionalPrefix: string;
  /** Debug messages are written as info messages (debug log of a single device). */
  public readonly debugAsInfo: boolean;

  constructor(logger: Logger, additionalPrefix: string, debugAsInfo = false) {
    this.logger = logger;
    this.prefix = logger.prefix;
    this.additionalPrefix = additionalPrefix;
    this.debugAsInfo = debugAsInfo;
  }

  log(level: LogLevel, message: string, ...parameters: any[]): void {
    if (level === LogLevel.DEBUG && this.debugAsInfo) {
      this.debug(message, ...parameters);
      return;
    }
    const fullMessage = `[${this.additionalPrefix}] ${message}`;
    this.logger.log(level, fullMessage, ...parameters);
  }

  debug(message: string, ...parameters: any[]): void {
    if (this.debugAsInfo) {
      this.logger.info(`[${this.additionalPrefix}] [debug] ${message}`, ...parameters);
      return;
    }
    const fullMessage = `[${this.additionalPrefix}] ${message}`;
    this.logger.debug(fullMessage, ...parameters);
  }

  info(message: string, ...parameters: any[]): void {
    const fullMessage = `[${this.additionalPrefix}] ${message}`;
    this.logger.info(fullMessage, ...parameters);
  }

  success(message: string, ...parameters: any[]): void {
    const fullMessage = `[${this.additionalPrefix}] ${message}`;
    this.logger.success(fullMessage, ...parameters);
  }

  warn(message: string, ...parameters: any[]): void {
    const fullMessage = `[${this.additionalPrefix}] ${message}`;
    this.logger.warn(fullMessage, ...parameters);
  }

  error(message: string, ...parameters: any[]): void {
    const fullMessage = `[${this.additionalPrefix}] ${message}`;
    this.logger.error(fullMessage, ...parameters);
  }
}
