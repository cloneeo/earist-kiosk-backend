type BarcodeHandler = (barcode: string) => void;

class BarcodeScannerService {
  private buffer: string = "";
  private handler: BarcodeHandler | null = null;
  private isListening: boolean = false;

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  public setHandler(handler: BarcodeHandler) {
    this.handler = handler;
  }

  public startListening() {
    if (this.isListening) return;
    document.addEventListener("keydown", this.handleKeyDown);
    this.isListening = true;
  }

  public stopListening() {
    if (!this.isListening) return;
    document.removeEventListener("keydown", this.handleKeyDown);
    this.isListening = false;
    this.buffer = ""; 
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      if (this.buffer.length > 0 && this.handler) {
        this.handler(this.buffer);
      }
      this.buffer = ""; 
      return;
    }
    if (event.key.length === 1) { 
      this.buffer += event.key;
    }
  }
}

export const barcodeService = new BarcodeScannerService();