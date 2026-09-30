class ApiError extends Error {
  constructor(statusCode, message, errors) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
  }

  static badRequest(msg = 'Bad request', errors) {
    return new ApiError(400, msg, errors);
  }
  static unauthorized(msg = 'Not authenticated. Please log in.') {
    return new ApiError(401, msg);
  }
  static forbidden(msg = 'You do not have permission to perform this action.') {
    return new ApiError(403, msg);
  }
  static notFound(msg = 'Resource not found') {
    return new ApiError(404, msg);
  }
  static conflict(msg = 'Conflict') {
    return new ApiError(409, msg);
  }
}

module.exports = ApiError;
