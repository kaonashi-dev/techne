import { BnestFactory } from "@kaonashi-dev/bnest";
import { AppModule } from "./app.module";

const app = BnestFactory.create(AppModule);
const port = Number(Bun.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
