import '../../core/widgets/backend_panels.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';
import '../../core/widgets/responsive_content.dart';
import '../../core/widgets/authenticated_back.dart';
import '../../models/user_role.dart';
import '../profile/profile_screen.dart';

class AlertsScreen extends StatefulWidget {
  final UserRole userRole;
  final String? childId;
  final String? category;

  const AlertsScreen({
    super.key,
    this.userRole = UserRole.parent,
    this.childId,
    this.category,
  });

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  @override
  Widget build(BuildContext context) {
    return AuthenticatedBackScope(
      userRole: widget.userRole,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: SingleChildScrollView(
            child: ResponsiveContent(
              maxWidth: 620,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        AuthenticatedBackButton(userRole: widget.userRole),
                        Expanded(
                          child: Text(
                            widget.category == 'updates'
                                ? 'Other Notifications'
                                : 'Alerts',
                            style: TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: context.translate('View profile'),
                          onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) =>
                                  ProfileScreen(userRole: widget.userRole),
                            ),
                          ),
                          icon: const Icon(
                            Icons.tune_rounded,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (widget.userRole == UserRole.teacher)
                      const TeacherAlertsPanel()
                    else
                      ChildPanel(
                        section: widget.category == 'updates'
                            ? 'updates'
                            : 'alerts',
                        alertCategory: widget.category,
                        tab: 2,
                        childId: widget.childId,
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
