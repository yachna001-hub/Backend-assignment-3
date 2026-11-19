const express = require("express");
const productController = require("../controllers/productController");

const router = express.Router();

router.get("/low-stock", productController.getLowStockProducts);
router.get("/summary", productController.getProductSummary);

router.post("/", productController.createProduct);
router.get("/", productController.getProducts);
router.patch("/:id/stock", productController.updateStock);
router.get("/:id", productController.getProduct);
router.put("/:id", productController.updateProduct);
router.delete("/:id", productController.deleteProduct);

module.exports = router;
