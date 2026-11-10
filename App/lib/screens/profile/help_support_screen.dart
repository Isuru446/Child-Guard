import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/widgets/responsive_content.dart';
import '../../models/user_role.dart';

class HelpSupportScreen extends StatelessWidget {
  final UserRole userRole;

  const HelpSupportScreen({super.key, required this.userRole});

  bool get _isTeacher => userRole == UserRole.teacher;

  void _showContactDetails(BuildContext context, String method) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(method),
        content: Text(
          BackendSession.instance.signedIn
              ? 'School contact details are not configured. Use your verified emergency contacts.'
              : method == 'Call school'
              ? 'Please contact the school office on +1 202 555 0100.'
              : 'Please email support@example.invalid with your question.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (BackendSession.instance.signedIn) {
      return const UnavailablePanel(
        title: 'Help & support',
        message: 'Only linked family data or your assigned center is available. Sign out on shared devices. Profile and emergency contacts can be edited in Account management; Live Location shows stored wearable GPS. Pickup requests require the reviewed storage migration. SOS opens your native dialer; automatic emergency dispatch and background notifications are unavailable. Contact your daycare through its established contact details.',
      );
    }
    final questions = _isTeacher
        ? const [
            (
              'How do I verify a student pickup?',
              'Open Pickup from the home screen, enter the guardian’s pickup code, and confirm the student details before release.',
            ),
            (
              'How do I update attendance?',
              'Open Attendance from the home screen to review the selected date and attendance records.',
            ),
            (
              'Who can view student details?',
              'Student information should only be accessed by authorized school staff for school-related duties.',
            ),
          ]
        : const [
            (
              'How do I add an authorized pickup person?',
              'Open Profile, choose Authorized Pickups, and follow the steps to register a trusted pickup person.',
            ),
            (
              'Where can I find my child’s latest location?',
              'Choose Live Location to view authorized stored wearable GPS and its timestamp. Historical or unavailable GPS does not establish safety.',
            ),
            (
              'What should I do if there is an emergency?',
              'SOS can open the native emergency dialer or your saved contacts. You must press Call yourself; emergency dispatch is not automated.',
            ),
          ];

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Help & Support'),
        leading: IconButton(
          tooltip: context.translate('Back'),
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
      ),
      body: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 28),
          child: ResponsiveContent(
            maxWidth: 640,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SupportBanner(isTeacher: _isTeacher),
                const SizedBox(height: 22),
                const Text(
                  'Frequently asked questions',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 10),
                Material(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(17),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    children: [
                      for (var i = 0; i < questions.length; i++) ...[
                        if (i > 0)
                          const Divider(height: 1, indent: 16, endIndent: 16),
                        ExpansionTile(
                          key: PageStorageKey<String>(questions[i].$1),
                          tilePadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                          ),
                          childrenPadding: const EdgeInsets.fromLTRB(
                            16,
                            0,
                            16,
                            16,
                          ),
                          iconColor: AppColors.primaryBlue,
                          collapsedIconColor: AppColors.textSecondary,
                          title: Text(
                            questions[i].$1,
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          children: [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: Text(
                                questions[i].$2,
                                style: const TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 13,
                                  height: 1.45,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                const Text(
                  'Contact your school',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(17),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const CircleAvatar(
                            backgroundColor: Color(0xFFE7F1FF),
                            child: Icon(
                              Icons.school_outlined,
                              color: AppColors.primaryBlue,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Greenwood School',
                                  style: TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  _isTeacher
                                      ? 'Staff support · School office'
                                      : 'Family support · School office',
                                  style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: () =>
                              _showContactDetails(context, 'Call school'),
                          icon: const Icon(Icons.call_outlined),
                          label: const Text('Call school office'),
                        ),
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: () =>
                              _showContactDetails(context, 'Email school'),
                          icon: const Icon(Icons.email_outlined),
                          label: const Text('Email support'),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                const Center(
                  child: Text(
                    'ChildGuard · Demo support information',
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SupportBanner extends StatelessWidget {
  final bool isTeacher;

  const _SupportBanner({required this.isTeacher});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.primaryBlue,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.support_agent_rounded,
            color: Colors.white,
            size: 38,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isTeacher ? 'Teacher help center' : 'Parent help center',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 5),
                const Text(
                  'Find quick answers or get in touch with your school.',
                  style: TextStyle(
                    color: Color(0xFFE5F1FF),
                    fontSize: 12,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
