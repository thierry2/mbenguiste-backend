const { z } = require('zod');

const swipe = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    action: z.enum(['pass', 'like', 'super_like']),
  }),
});

module.exports = { swipe };
