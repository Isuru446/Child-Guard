import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/widgets/responsive_content.dart';
import '../../core/widgets/app_avatar.dart';

import '../profile/profile_screen.dart';

import '../../core/app_colors.dart';
import '../../models/user_role.dart';
import '../attendance/attendance_record_screen.dart';

class HistoryScreen extends StatefulWidget {
  final UserRole userRole;
  final String? childId;

  const HistoryScreen({
    super.key,
    this.userRole = UserRole.parent,
    this.childId,
  });

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  DateTime _selectedActivityDate = DateUtils.dateOnly(DateTime.now());

  @override
  Widget build(BuildContext context) {
    if (BackendSession.instance.signedIn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Activity history')),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: ChildPanel(section: 'activity', childId: widget.childId),
        ),
      );
    }
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FA),
      body: SingleChildScrollView(
        child: ResponsiveContent(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHistoryHeader(),
              if (widget.userRole == UserRole.teacher)
                _buildTeacherActivity()
              else ...[
                const SizedBox(height: 16),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _buildMetricsCard(context),
                ),
                const SizedBox(height: 24),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20),
                  child: Text(
                    'TODAY · WED APR 29',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.8,
                      color: Color(0xFF64748B),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _buildConnectedTimeline(),
                ),
              ],
              const SizedBox(height: 100), // Space above bottom navigation bar
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTeacherActivity() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: _selectActivityDate,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.calendar_month_outlined,
                      color: AppColors.primaryBlue,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'ACTIVITY DATE',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              letterSpacing: 0.7,
                              color: Color(0xFF64748B),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            MaterialLocalizations.of(context)
                                .formatMediumDate(_selectedActivityDate),
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: Color(0xFF1E293B),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.keyboard_arrow_down_rounded,
                      color: Color(0xFF64748B),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          _buildConnectedTimeline(),
        ],
      ),
    );
  }

  Future<void> _selectActivityDate() async {
    final today = DateUtils.dateOnly(DateTime.now());
    final selectedDate = await showDatePicker(
      context: context,
      initialDate: _selectedActivityDate,
      firstDate: DateTime(2020),
      lastDate: today,
    );

    if (selectedDate == null || !mounted) return;
    setState(() {
      _selectedActivityDate = DateUtils.dateOnly(selectedDate);
    });
  }

  Widget _buildHistoryHeader() {
    final isTeacher = widget.userRole == UserRole.teacher;
    final name = isTeacher ? 'Ms. Thompson' : 'Sarah';
    final avatar = isTeacher
        ? 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150'
        : 'https://i.pravatar.cc/150?img=11';

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: AppColors.primaryBlue,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
      ),
      padding: EdgeInsets.fromLTRB(
        24,
        MediaQuery.paddingOf(context).top + 24,
        24,
        28,
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Hello,',
                      style: TextStyle(color: Colors.white70, fontSize: 18),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      name,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              InkWell(
                borderRadius: BorderRadius.circular(40),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => ProfileScreen(userRole: widget.userRole),
                  ),
                ),
                child: Tooltip(
                  message: 'View profile',
                  child: Stack(
                    children: [
                      Container(
                        width: 68,
                        height: 68,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.5),
                            width: 2,
                          ),
                        ),
                        child: AppAvatar(
                          imageUrl: avatar,
                          size: 64,
                          fallbackIcon: Icons.child_care_rounded,
                          borderColor: Colors.white,
                          borderWidth: 2,
                        ),
                      ),
                      Positioned(
                        bottom: 0,
                        right: 4,
                        child: Container(
                          width: 18,
                          height: 18,
                          decoration: BoxDecoration(
                            color: Colors.lightGreenAccent.shade400,
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Row(
              children: [
                const Icon(Icons.circle, color: Colors.greenAccent, size: 10),
                const SizedBox(width: 8),
                Text(
                  isTeacher ? 'Greenwood Primary' : 'At School · Safe Zone',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                Text(
                  isTeacher ? 'Room A Teacher' : '· Greenwood Primary',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricsCard(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              // Attendance card replacing Steps (opens attendance record on tap)
              Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(20),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (context) => const AttendanceRecordScreen(),
                      ),
                    );
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE8F5E9),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: const Color(0xFFC8E6C9),
                        width: 1.2,
                      ),
                    ),
                    child: Column(
                      children: const [
                        Icon(
                          Icons.calendar_today_rounded,
                          color: Color(0xFF2E7D32),
                          size: 22,
                        ),
                        SizedBox(height: 8),
                        Text(
                          '94%',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF1E293B),
                          ),
                        ),
                        SizedBox(height: 2),
                        Text(
                          'Attendance',
                          style: TextStyle(
                            fontSize: 11,
                            color: Color(0xFF2E7D32),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              _buildMetricPill(
                icon: Icons.location_on_outlined,
                value: '14',
                label: 'Places',
              ),
              const SizedBox(width: 10),
              _buildMetricPill(
                icon: Icons.show_chart_rounded,
                value: '6h 12m',
                label: 'Active',
              ),
            ],
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: const [
              Text(
                'M',
                style: TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                'T',
                style: TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                'W',
                style: TextStyle(
                  color: AppColors.primaryBlue,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                'T',
                style: TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                'F',
                style: TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                'S',
                style: TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              Text(
                'S',
                style: TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetricPill({
    required IconData icon,
    required String value,
    required String label,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          children: [
            Icon(icon, color: AppColors.primaryBlue, size: 22),
            const SizedBox(height: 8),
            Text(
              value,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1E293B),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                color: Color(0xFF64748B),
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildConnectedTimeline() {
    final today = DateUtils.dateOnly(DateTime.now());
    final yesterday = today.subtract(const Duration(days: 1));
    final teacherItems = DateUtils.isSameDay(_selectedActivityDate, today)
        ? [
            {
              'title': 'Attendance taken',
              'subtitle': 'Room A · 28 of 28 children',
              'time': '08:15',
              'icon': Icons.fact_check_outlined,
              'iconBg': const Color(0xFFD1F2D9),
              'iconColor': const Color(0xFF2E7D32),
            },
            {
              'title': 'Student arrived/check in at school',
              'subtitle': 'Mathematics · Room 5A',
              'time': '09:00',
              'icon': Icons.menu_book_outlined,
              'iconBg': const Color(0xFFD0E8FF),
              'iconColor': const Color(0xFF0077CC),
            },
            {
              'title': 'Student Pick up registered',
              'subtitle': 'East courtyard · Room A',
              'time': '12:10',
              'icon': Icons.restaurant_outlined,
              'iconBg': const Color(0xFFFFECC7),
              'iconColor': const Color(0xFFE65100),
            },
            {
              'title': 'SOS alert received',
              'subtitle': 'Gate B · All students accounted for',
              'time': '15:20',
              'icon': Icons.directions_walk_outlined,
              'iconBg': const Color(0xFFD1F2D9),
              'iconColor': const Color(0xFF2E7D32),
            },
          ]
        : DateUtils.isSameDay(_selectedActivityDate, yesterday)
        ? [
            {
              'title': 'Attendance taken',
              'subtitle': 'Room A · 27 of 28 children',
              'time': '08:17',
              'icon': Icons.fact_check_outlined,
              'iconBg': const Color(0xFFD1F2D9),
              'iconColor': const Color(0xFF2E7D32),
            },
            {
              'title': 'Parent meeting',
              'subtitle': 'Emily Carter · Student progress',
              'time': '10:30',
              'icon': Icons.people_outline,
              'iconBg': const Color(0xFFD0E8FF),
              'iconColor': const Color(0xFF0077CC),
            },
            {
              'title': 'Library visit',
              'subtitle': 'Room A · Reading period',
              'time': '13:15',
              'icon': Icons.local_library_outlined,
              'iconBg': const Color(0xFFFFECC7),
              'iconColor': const Color(0xFFE65100),
            },
            {
              'title': 'Dismissal completed',
              'subtitle': 'Gate B · Room A',
              'time': '15:18',
              'icon': Icons.directions_walk_outlined,
              'iconBg': const Color(0xFFD1F2D9),
              'iconColor': const Color(0xFF2E7D32),
            },
          ]
        : <Map<String, Object>>[];
    final parentItems = [
      {
        'title': 'Arrived home',
        'subtitle': 'Home · Safe zone',
        'time': '15:48',
        'icon': Icons.home_outlined,
        'iconBg': const Color(0xFFD1F2D9),
        'iconColor': const Color(0xFF2E7D32),
      },
      {
        'title': 'Bus drop-off',
        'subtitle': 'Stop 3 · Maple St',
        'time': '15:20',
        'icon': Icons.directions_bus_outlined,
        'iconBg': const Color(0xFFD0E8FF),
        'iconColor': const Color(0xFF0077CC),
      },
      {
        'title': 'Left school',
        'subtitle': 'Greenwood · Gate B',
        'time': '14:45',
        'icon': Icons.school_outlined,
        'iconBg': const Color(0xFFD0E8FF),
        'iconColor': const Color(0xFF0077CC),
      },
      {
        'title': 'High activity',
        'subtitle': 'Playground · School',
        'time': '12:10',
        'icon': Icons.show_chart_rounded,
        'iconBg': const Color(0xFFFFECC7),
        'iconColor': const Color(0xFFE65100),
      },
    ];
    final items = widget.userRole == UserRole.teacher
        ? teacherItems
        : parentItems;

    if (widget.userRole == UserRole.teacher && items.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Column(
          children: [
            Icon(Icons.event_busy_outlined, color: Color(0xFF94A3B8), size: 28),
            SizedBox(height: 8),
            Text(
              'No activity recorded for this date',
              style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final item = items[index];
        final isLast = index == items.length - 1;

        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 52,
                child: Column(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: item['iconBg'] as Color,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        item['icon'] as IconData,
                        color: item['iconColor'] as Color,
                        size: 22,
                      ),
                    ),
                    if (!isLast)
                      Expanded(
                        child: Container(
                          width: 2,
                          color: const Color(0xFFE2E8F0),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.03),
                        blurRadius: 10,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item['title'] as String,
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF1E293B),
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              item['subtitle'] as String,
                              style: const TextStyle(
                                fontSize: 12,
                                color: Color(0xFF64748B),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        item['time'] as String,
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF64748B),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
