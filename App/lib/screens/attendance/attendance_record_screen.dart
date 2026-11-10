import '../teacher/student_directory_screen.dart';
import '../../core/backend.dart';
import '../../core/widgets/backend_panels.dart';

import 'package:final_project/core/app_ui.dart';

import '../../core/app_colors.dart';

class AttendanceRecordScreen extends StatefulWidget {
  const AttendanceRecordScreen({
    super.key,
    this.isTeacherView = false,
    this.studentName,
  });

  final bool isTeacherView;
  final String? studentName;

  @override
  State<AttendanceRecordScreen> createState() => _AttendanceRecordScreenState();
}

class _AttendanceRecordScreenState extends State<AttendanceRecordScreen> {
  late DateTime _selectedDate;
  late DateTime _visibleWeekStart;
  final TextEditingController _searchController = TextEditingController();
  String _studentName = 'Demo Child';

  @override
  void initState() {
    super.initState();
    _selectedDate = DateTime.now();
    _visibleWeekStart = _weekStart(_selectedDate);
    _studentName = widget.studentName ?? _studentName;
  }

  DateTime _weekStart(DateTime date) =>
      DateTime(date.year, date.month, date.day - (date.weekday - 1));

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _changeWeek(int offset) {
    setState(() {
      _visibleWeekStart = _visibleWeekStart.add(Duration(days: offset * 7));
      _selectedDate = _visibleWeekStart.add(const Duration(days: 2));
    });
  }

  Future<void> _pickDate() async {
    final selected = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 30)),
    );
    if (selected == null || !mounted) return;
    setState(() {
      _selectedDate = selected;
      _visibleWeekStart = _weekStart(selected);
    });
  }

  Future<void> _showAllRecords() async {
    final today = DateUtils.dateOnly(DateTime.now());
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      backgroundColor: AppColors.background,
      builder: (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * 0.65,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
            itemCount: 30,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, index) {
              final date = today.subtract(Duration(days: index));
              final present = index != 2 && index != 6;
              return _RecentAttendanceTile(
                date: MaterialLocalizations.of(context).formatMediumDate(date),
                status: present ? 'Present' : 'Absent',
                isPresent: present,
                onTap: () {
                  setState(() {
                    _selectedDate = date;
                    _visibleWeekStart = _weekStart(date);
                  });
                  Navigator.pop(sheetContext);
                },
              );
            },
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isTeacherView) {
      return const StudentDirectoryScreen(showTeacherHeader: false);
    }

    final monthLabel = MaterialLocalizations.of(context)
        .formatMonthYear(_selectedDate);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.arrow_back_ios_new_rounded),
                        iconSize: 19,
                        color: AppColors.primaryBlue,
                      ),
                      const Expanded(
                        child: Text(
                          'Attendance',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: _pickDate,
                        icon: const Icon(Icons.tune_rounded),
                        color: AppColors.primaryBlue,
                      ),
                    ],
                  ),
                  if (widget.isTeacherView) ...[
                    const SizedBox(height: 8),
                    TextField(
                      controller: _searchController,
                      onChanged: (value) {
                        if (value.trim().isNotEmpty) {
                          setState(() => _studentName = value.trim());
                        }
                      },
                      decoration: InputDecoration(
                        hintText: context.translate('Search student'),
                        prefixIcon: Icon(Icons.search_rounded),
                      ),
                    ),
                  ],
                  const SizedBox(height: 14),
                  _buildCalendarCard(monthLabel),
                  const SizedBox(height: 18),
                  if (BackendSession.instance.signedIn)
                    ChildPanel(
                      section: 'attendance',
                      day: _selectedDate.toIso8601String().split('T').first,
                    )
                  else ...[
                    Text(
                      widget.isTeacherView
                          ? _studentName
                          : 'Demo Child · Room A',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 10),
                    _AttendanceTile(
                      icon: Icons.login_rounded,
                      iconColor: AppColors.greenOnline,
                      title: 'Check In',
                      subtitle: 'School - Main Gate',
                      time: '08:15 AM',
                    ),
                    const SizedBox(height: 9),
                    _AttendanceTile(
                      icon: Icons.logout_rounded,
                      iconColor: const Color(0xFF6C8DB7),
                      title: 'Check Out',
                      subtitle: 'School - Main Gate',
                      time: '04:30 PM',
                    ),
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Recent Attendance',
                          style: TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        TextButton(
                          onPressed: _showAllRecords,
                          child: const Text('See all'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    _RecentAttendanceTile(
                      date: '14 Oct 2026',
                      status: 'Present',
                      isPresent: true,
                    ),
                    const SizedBox(height: 8),
                    _RecentAttendanceTile(
                      date: '13 Oct 2026',
                      status: 'Present',
                      isPresent: true,
                    ),
                    const SizedBox(height: 8),
                    _RecentAttendanceTile(
                      date: '12 Oct 2026',
                      status: 'Absent',
                      isPresent: false,
                    ),
                    const SizedBox(height: 8),
                    _RecentAttendanceTile(
                      date: '11 Oct 2026',
                      status: 'Present',
                      isPresent: true,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCalendarCard(String monthLabel) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0B123B75),
            blurRadius: 14,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => _changeWeek(-1),
                icon: const Icon(Icons.chevron_left_rounded),
                color: AppColors.primaryBlue,
              ),
              Expanded(
                child: Text(
                  monthLabel,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => _changeWeek(1),
                icon: const Icon(Icons.chevron_right_rounded),
                color: AppColors.primaryBlue,
              ),
            ],
          ),
          Row(
            children: List.generate(7, (index) {
              final date = _visibleWeekStart.add(Duration(days: index));
              final isSelected = DateUtils.isSameDay(date, _selectedDate);
              final isToday = DateUtils.isSameDay(date, DateTime.now());
              return Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(20),
                  onTap: () => setState(() => _selectedDate = date),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Column(
                      children: [
                        Text(
                          const [
                            'Mon',
                            'Tue',
                            'Wed',
                            'Thu',
                            'Fri',
                            'Sat',
                            'Sun',
                          ][index],
                          style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 10,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Container(
                          width: 32,
                          height: 32,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: isSelected
                                ? AppColors.primaryBlue
                                : isToday
                                ? const Color(0xFFE7F0FF)
                                : null,
                            shape: BoxShape.circle,
                          ),
                          child: Text(
                            '${date.day}',
                            style: TextStyle(
                              color: isSelected
                                  ? Colors.white
                                  : AppColors.textPrimary,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}

class _AttendanceTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final String time;

  const _AttendanceTile({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.time,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: iconColor, size: 20),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          Text(
            time,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _RecentAttendanceTile extends StatelessWidget {
  final String date;
  final String status;
  final bool isPresent;
  final VoidCallback? onTap;

  const _RecentAttendanceTile({
    required this.date,
    required this.status,
    required this.isPresent,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = isPresent ? AppColors.greenOnline : AppColors.sosRed;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(13)),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  date,
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 11,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.13),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  status,
                  style: TextStyle(
                    color: color,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
