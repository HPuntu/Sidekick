/**
 * Minimal stand-in for the `obsidian` module, which only exists inside the app.
 * Vitest aliases `obsidian` here so pure modules that reference TFile/TFolder
 * for `instanceof` checks can be tested outside Obsidian.
 *
 * Only add to this as tests need it. Anything requiring real Obsidian
 * behaviour belongs in a manual check, not a unit test.
 */

export class TAbstractFile {
  path = "";
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class TFile extends TAbstractFile {
  extension = "";
  stat = { ctime: 0, mtime: 0, size: 0 };
}

export class Component {
  load(): void {}
  unload(): void {}
  addChild<T>(child: T): T {
    return child;
  }
  removeChild<T>(child: T): T {
    return child;
  }
}

export class Notice {
  constructor(public message: string) {}
}

/**
 * settings.ts defines a PluginSettingTab subclass at module scope, so importing
 * anything from it (DEFAULT_SETTINGS, for instance) evaluates that class.
 */
export class PluginSettingTab {
  constructor(
    public app: unknown,
    public plugin: unknown
  ) {}
  display(): void {}
}

export class Setting {
  constructor(public containerEl: unknown) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  setHeading(): this {
    return this;
  }
  addText(): this {
    return this;
  }
  addTextArea(): this {
    return this;
  }
  addToggle(): this {
    return this;
  }
  addDropdown(): this {
    return this;
  }
  addSlider(): this {
    return this;
  }
  addButton(): this {
    return this;
  }
}
