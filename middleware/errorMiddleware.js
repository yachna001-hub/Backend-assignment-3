module.exports = (error, req, res, next) => {
  let statusCode = error.statusCode || error.status || 500;
  let message = error.message || "Internal server error";

  if (error.code === 11000) {
    statusCode = 409;
    message = "A product with this SKU already exists";
  } else if (error.name === "ValidationError" || error.name === "CastError") {
    statusCode = 400;
  }

  if (statusCode >= 500) {
    console.error(error);
    message = "Internal server error";
  }

  res.status(statusCode).json({ message });
};
