import { BnestFactory } from "@kaonashi-dev/bnest/core";
import { AppModule } from "./app.module";

const app = await BnestFactory.create(AppModule);
const port = Number(Bun.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
