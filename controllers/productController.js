const Product = require("../models/Product");

const productFields = new Set([
  "name",
  "sku",
  "category",
  "price",
  "quantity",
  "reorderLevel",
  "supplier",
]);
const sortableFields = new Set([
  ...productFields,
  "createdAt",
  "updatedAt",
]);

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireObjectId(id) {
  if (!/^[a-f\d]{24}$/i.test(id)) {
    throw createError("Invalid product ID", 400);
  }
}

function validateProductBody(body, allowEmpty = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError("Request body must be a JSON object", 400);
  }

  const keys = Object.keys(body);
  if (!allowEmpty && keys.length === 0) {
    throw createError("Request body cannot be empty", 400);
  }

  const unknownFields = keys.filter((key) => !productFields.has(key));
  if (unknownFields.length > 0) {
    throw createError(`Unknown product field: ${unknownFields[0]}`, 400);
  }
}

function queryString(value, name) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw createError(`${name} must be a string`, 400);
  }
  return value;
}

function parseInteger(value, name, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw createError(`${name} must be a positive integer`, 400);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw createError(`${name} must be a positive integer`, 400);
  }
  return parsed;
}

function parsePrice(value, name) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw createError(`${name} must be a non-negative number`, 400);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createError(`${name} must be a non-negative number`, 400);
  }
  return parsed;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

exports.createProduct = asyncHandler(async (req, res) => {
  validateProductBody(req.body, true);
  const product = await Product.create(req.body);
  res.status(201).json(product);
});

exports.getProducts = asyncHandler(async (req, res) => {
  const filter = {};
  const category = queryString(req.query.category, "category");
  const supplier = queryString(req.query.supplier, "supplier");
  const search = queryString(req.query.search, "search");
  const minPrice = parsePrice(req.query.minPrice, "minPrice");
  const maxPrice = parsePrice(req.query.maxPrice, "maxPrice");
  const page = parseInteger(req.query.page, "page", 1);
  const limit = parseInteger(req.query.limit, "limit", 10);
  const sortParameter = queryString(req.query.sort, "sort");

  if (category !== undefined) {
    filter.category = category;
  }
  if (supplier !== undefined) {
    filter.supplier = supplier;
  }
  if (search !== undefined) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escapedSearch, $options: "i" } },
      { sku: { $regex: escapedSearch, $options: "i" } },
    ];
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) {
      filter.price.$gte = minPrice;
    }
    if (maxPrice !== undefined) {
      filter.price.$lte = maxPrice;
    }
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw createError("minPrice cannot be greater than maxPrice", 400);
    }
  }

  const sort = sortParameter || "-createdAt";
  if (!/^-?[A-Za-z]\w*$/.test(sort) || !sortableFields.has(sort.replace(/^-/, ""))) {
    throw createError("sort contains an unsupported field or direction", 400);
  }

  const [total, products] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
  ]);

  res.json({
    total,
    page,
    totalPages: Math.ceil(total / limit),
    count: products.length,
    products,
  });
});

exports.getLowStockProducts = asyncHandler(async (req, res) => {
  const lowStockItems = await Product.aggregate([
    {
      $match: {
        $expr: { $lte: ["$quantity", "$reorderLevel"] },
      },
    },
    {
      $addFields: {
        stockValue: { $multiply: ["$price", "$quantity"] },
        id: { $toString: "$_id" },
      },
    },
  ]);

  res.json({ count: lowStockItems.length, lowStockItems });
});

exports.getProductSummary = asyncHandler(async (req, res) => {
  const summary = await Product.aggregate([
    {
      $group: {
        _id: "$category",
        totalItems: { $sum: 1 },
        totalQuantity: { $sum: "$quantity" },
        totalStockValue: {
          $sum: { $multiply: ["$price", "$quantity"] },
        },
        avgPrice: { $avg: "$price" },
      },
    },
  ]);

  res.json({ categories: summary.length, summary });
});

exports.getProduct = asyncHandler(async (req, res) => {
  requireObjectId(req.params.id);
  const product = await Product.findById(req.params.id);
  if (!product) {
    throw createError("Product not found", 404);
  }
  res.json(product);
});

exports.updateProduct = asyncHandler(async (req, res) => {
  requireObjectId(req.params.id);
  validateProductBody(req.body);

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  );
  if (!product) {
    throw createError("Product not found", 404);
  }
  res.json(product);
});

exports.updateStock = asyncHandler(async (req, res) => {
  requireObjectId(req.params.id);

  if (
    !req.body ||
    typeof req.body !== "object" ||
    Array.isArray(req.body) ||
    Object.keys(req.body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(req.body, "change")
  ) {
    throw createError('Request body must contain only a "change" number', 400);
  }

  const { change } = req.body;
  if (typeof change !== "number" || !Number.isFinite(change)) {
    throw createError('"change" must be a finite number', 400);
  }

  const conditions = { _id: req.params.id };
  if (change < 0) {
    conditions.quantity = { $gte: -change };
  }

  const product = await Product.findOneAndUpdate(
    conditions,
    { $inc: { quantity: change } },
    { new: true, runValidators: true }
  );

  if (!product) {
    const exists = await Product.exists({ _id: req.params.id });
    if (!exists) {
      throw createError("Product not found", 404);
    }
    throw createError("Insufficient stock for this change", 400);
  }

  res.json({ message: "Stock updated", product });
});

exports.deleteProduct = asyncHandler(async (req, res) => {
  requireObjectId(req.params.id);
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) {
    throw createError("Product not found", 404);
  }
  res.json({ message: "Product deleted", id: product.id });
});
