import { App, ButtonComponent, Modal } from "obsidian";

export function confirmLocalRisk(
  app: App,
  title: string,
  message: string
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmationModal(app, title, message, resolve).open();
  });
}

class ConfirmationModal extends Modal {
  private readonly onResolve: (confirmed: boolean) => void;
  private readonly message: string;
  private readonly titleText: string;
  private resolved = false;

  constructor(
    app: App,
    title: string,
    message: string,
    onResolve: (confirmed: boolean) => void
  ) {
    super(app);
    this.titleText = title;
    this.message = message;
    this.onResolve = onResolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.titleText });

    for (const paragraph of this.message.split(/\n\n+/)) {
      contentEl.createEl("p", { text: paragraph });
    }

    const actionsEl = contentEl.createDiv({
      cls: "agent-dashboard__export-actions"
    });
    new ButtonComponent(actionsEl)
      .setButtonText("Cancel")
      .onClick(() => this.finish(false));
    new ButtonComponent(actionsEl)
      .setButtonText("Continue")
      .setCta()
      .onClick(() => this.finish(true));
  }

  // Dismissing the modal any other way counts as declining.
  onClose(): void {
    this.finish(false);
  }

  private finish(confirmed: boolean): void {
    if (this.resolved) {
      return;
    }

    this.resolved = true;
    this.onResolve(confirmed);
    this.close();
  }
}
