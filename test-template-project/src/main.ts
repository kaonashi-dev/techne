import { NestiaFactory } from "nestia";
import { AppModule } from "./app.module";

const app = NestiaFactory.create(AppModule);

app.listen(5775, () => {
  console.log(`🦊 Server running at http://${app.server?.hostname}:${app.server?.port}`);
});
