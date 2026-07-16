import { Router, type IRouter } from "express";
import healthRouter from "./health";
import twilioRouter from "./twilio.js";
import adminRouter  from "./admin.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/twilio", twilioRouter);
router.use("/admin",  adminRouter);   // accessible at /api/admin/token through proxy

export default router;
