const router = require('express').Router();
const ctrl = require('../controllers/savedJobController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { validate, mongoIdParam } = require('../middleware/validationMiddleware');

router.use(protect, authorize('job_seeker'));

router.get('/', ctrl.getSavedJobs);
router.get('/ids', ctrl.getSavedJobIds);
router.post('/:jobId', [mongoIdParam('jobId')], validate, ctrl.saveJob);
router.delete('/:jobId', [mongoIdParam('jobId')], validate, ctrl.removeSavedJob);

module.exports = router;
