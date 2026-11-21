package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.math.Pose;

/**
 * Carries the robot pose from auto into teleop. Statics live as long as the robot app, so the
 * pose an auto ends at is still here when the preselected teleop inits. Teleop keeps saving too,
 * so re-initing teleop mid-practice picks up where it left off.
 */
public final class PoseHandoff {
    private static Pose pose;
    private static Alliance alliance;

    private PoseHandoff() {}

    public static void save(Pose pose, Alliance alliance) {
        if (pose == null || !Double.isFinite(pose.x()) || !Double.isFinite(pose.y())
                || !Double.isFinite(pose.heading())) return;
        PoseHandoff.pose = pose;
        PoseHandoff.alliance = alliance;
    }

    /** The last saved pose if it came from the same alliance, otherwise null. */
    public static Pose get(Alliance alliance) {
        return alliance == PoseHandoff.alliance ? pose : null;
    }
}
