const ApiError = require('../utils/ApiError');

/** Restricts a route to the given roles. Must run after `protect`. */
const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to access this resource.'));
    }
    return next();
  };

module.exports = { authorize };
