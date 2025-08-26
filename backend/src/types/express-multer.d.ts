import "express-serve-static-core";
import type { File } from "multer";

declare module "express-serve-static-core" {
    interface Request {
        files?: File[] | { [fieldname: string]: File[] };
    }
}
