'use strict';

/**
 * Creates a middleware that validates req.body, req.query, or req.params using a Zod schema.
 * @param {import('zod').AnyZodObject} schema
 * @param {'body' | 'query' | 'params'} property
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    try {
      const validatedData = schema.parse(req[property]);
      // Overwrite the request property with validated (and potentially coerced/transformed) data
      req[property] = validatedData;
      next();
    } catch (err) {
      if (err.name === 'ZodError') {
        const issues = err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        return res.status(400).json({
          error: 'Validation failed',
          details: issues,
        });
      }
      console.error('[validate middleware]', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
};

module.exports = { validate };
