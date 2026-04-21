export interface SwaggerDocumentOptions {
  title?: string;
  description?: string;
  version?: string;
}

export class DocumentBuilder {
  private readonly config: SwaggerDocumentOptions = {};

  setTitle(title: string) {
    this.config.title = title;
    return this;
  }

  setDescription(description: string) {
    this.config.description = description;
    return this;
  }

  setVersion(version: string) {
    this.config.version = version;
    return this;
  }

  build(): SwaggerDocumentOptions {
    return { ...this.config };
  }
}
