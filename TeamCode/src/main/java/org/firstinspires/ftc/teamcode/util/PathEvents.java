package org.firstinspires.ftc.teamcode.util;

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.config.ConfigVar;
import com.pedropathing.api.PoseFactory;
import com.pedropathing.follower.Follower;
import com.pedropathing.ivy.Command;
import com.pedropathing.ivy.CommandBuilder;
import com.pedropathing.ivy.commands.Commands;
import com.pedropathing.ivy.groups.Groups;
import com.pedropathing.math.Vector2D;
import com.pedropathing.paths.Path;
import com.pedropathing.paths.curves.Curve;
import com.pedropathing.utils.Angle;

import org.firstinspires.ftc.teamcode.Robot;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

public final class PathEvents {
    private PathEvents() {}

    public static final class Marker {
        private final double at;
        private final Command command;
        private boolean fired;

        private Marker(double at, Command command) {
            this.at = at;
            this.command = command;
        }
    }

    public static final class Zone {
        private final double from, to, maxSpeed;
        private boolean engaged;

        private Zone(double from, double to, double maxSpeed) {
            this.from = from;
            this.to = to;
            this.maxSpeed = maxSpeed;
        }
    }

    public static final class HeadingTarget {
        private final double fraction, degrees;

        private HeadingTarget(double fraction, double degrees) {
            this.fraction = fraction;
            this.degrees = degrees;
        }
    }

    public static HeadingTarget headingTarget(double fraction, double degrees) {
        if (!(fraction > 0 && fraction < 1)) {
            throw new IllegalArgumentException("headingTarget(...) position is a fraction of the path between 0 and 1, got " + fraction);
        }
        return new HeadingTarget(fraction, degrees);
    }

    public static Path withHeadingTargets(Alliance alliance, Path path, HeadingTarget... targets) {
        if (targets.length == 0) return path;
        PoseFactory factory = Utilities.poseFactory(alliance);
        HeadingTarget[] sorted = targets.clone();
        Arrays.sort(sorted, Comparator.comparingDouble(t -> t.fraction));

        int n = sorted.length + 2;
        double[] at = new double[n];
        double[] heading = new double[n];
        at[0] = 0;
        heading[0] = path.heading(0);
        for (int i = 0; i < sorted.length; i++) {
            at[i + 1] = sorted[i].fraction;
            heading[i + 1] = factory.of(0, 0, sorted[i].degrees).heading();
        }
        at[n - 1] = 1;
        heading[n - 1] = path.heading(1);

        return path.heading((curve, t) -> {
            double progress = curve.pathCompletion(t);
            int i = 0;
            while (i < n - 2 && progress > at[i + 1]) i++;
            double span = at[i + 1] - at[i];
            double u = span > 0 ? Math.min(1, Math.max(0, (progress - at[i]) / span)) : 1;
            return Angle.normalize(heading[i] + Angle.normalizeSigned(heading[i + 1] - heading[i]) * u);
        });
    }

    public static Marker at(double fraction, Command command) {
        return new Marker(fraction, command);
    }

    public static Zone limit(double from, double to, double maxSpeed) {
        if (!(maxSpeed > 0 && maxSpeed <= 1)) {
            throw new IllegalArgumentException("limit(...) speed is a fraction of full speed between 0 and 1, got " + maxSpeed);
        }
        return new Zone(from, to, maxSpeed);
    }

    public static Command follow(Robot robot, Path path, Object... events) {
        List<Marker> markers = new ArrayList<>();
        List<Zone> zones = new ArrayList<>();
        for (Object e : events) {
            if (e instanceof Marker) markers.add((Marker) e);
            else if (e instanceof Zone) zones.add((Zone) e);
            else throw new IllegalArgumentException("Expected at(...) or limit(...), got " + e);
        }
        Command follow = robot.drivetrain.follow(path);
        if (markers.isEmpty() && zones.isEmpty()) return follow;
        markers.sort(Comparator.comparingDouble(m -> m.at));
        Watcher watcher = new Watcher(robot, path, markers, zones);
        // Deadline ends the watcher the same tick the path finishes, without a final update, and
        // Pedro calls a path done just short of 100% -- so markers near the end (e.g. at(1, ...))
        // would never fire. The sequential step only runs if the path completed (not if interrupted).
        return Groups.sequential(
                Groups.deadline(follow, watcher.command()),
                Commands.instant(watcher::fireRemaining)
        );
    }

    private static final class Watcher {
        private final Robot robot;
        private final Path path;
        private final List<Marker> markers;
        private final List<Zone> zones;
        private ConfigVar<Double> speedLimit;
        private double normalLimit;
        private double appliedLimit;
        private double t;

        Watcher(Robot robot, Path path, List<Marker> markers, List<Zone> zones) {
            this.robot = robot;
            this.path = path;
            this.markers = markers;
            this.zones = zones;
        }

        Command command() {
            return new CommandBuilder()
                    .setStart(this::start)
                    .setExecute(this::update)
                    .setEnd((end) -> restore())
                    .setDone(() -> false);
        }

        private void start() {
            t = 0;
            for (Marker m : markers) m.fired = false;
            for (Zone z : zones) z.engaged = false;
            Follower follower = robot.drivetrain.getFollower();
            if (!zones.isEmpty() && follower.algorithm() instanceof Foresight) {
                speedLimit = ((Foresight) follower.algorithm()).config.maxPathSpeed;
                normalLimit = speedLimit.get();
                appliedLimit = normalLimit;
            } else {
                speedLimit = null;
            }
        }

        private void update() {
            Follower follower = robot.drivetrain.getFollower();
            Curve curve = path.curve;
            Vector2D position = follower.pose().toVector2D();
            t = curve.closestParameter(position, t);
            double progress = curve.pathCompletion(t);
            double length = curve.length();
            double speed = Math.max(0, follower.tangentialVelocity());

            double lead = length > 0 ? speed * Constants.Auto.eventLeadSeconds / length : 0;
            for (Marker m : markers) {
                if (!m.fired && progress + lead >= m.at) {
                    m.fired = true;
                    m.command.schedule();
                }
            }

            if (speedLimit != null) {
                Foresight foresight = (Foresight) follower.algorithm();
                double decel = foresight.config.naturalForwardDeceleration.get();
                double top = foresight.config.maxAchievableForwardVelocity.get();
                double limit = normalLimit;
                for (Zone z : zones) {
                    if (!z.engaged && progress < z.to) {
                        double target = z.maxSpeed * top;
                        double braking = decel > 0 && speed > target ? (speed * speed - target * target) / (2 * decel) : 0;
                        if ((z.from - progress) * length <= braking) z.engaged = true;
                    }
                    if (z.engaged && progress < z.to) limit = Math.min(limit, z.maxSpeed);
                }
                if (limit != appliedLimit) {
                    speedLimit.set(limit);
                    appliedLimit = limit;
                }
            }
        }

        private void fireRemaining() {
            for (Marker m : markers) {
                if (!m.fired) {
                    m.fired = true;
                    m.command.schedule();
                }
            }
        }

        private void restore() {
            if (speedLimit != null && appliedLimit != normalLimit) {
                speedLimit.set(normalLimit);
                appliedLimit = normalLimit;
            }
        }
    }
}
